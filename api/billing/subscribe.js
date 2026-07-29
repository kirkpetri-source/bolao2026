// Cobrança da mensalidade do organizador. O dinheiro vai para a conta Woovi da
// LION TECH — nunca para a do organizador, que é onde caem as apostas dos
// participantes (api/payments/woovi-charge.js).
import axios from 'axios';
import { getAdminAuth, getAdminDb } from '../_shared/firebaseAdmin.js';
import { trialSubscription, accessEndsAt, evaluateStatus, PROMO_PRICE_CENTS } from '../_shared/subscription.js';

const WOOVI_API = 'https://api.openpix.com.br/api/v1';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { idToken, tenantId } = req.body || {};
    if (!idToken || !tenantId) return res.status(400).json({ error: 'Parâmetros: idToken, tenantId' });

    const db = getAdminDb();

    let decoded;
    try { decoded = await getAdminAuth().verifyIdToken(idToken); }
    catch { return res.status(401).json({ error: 'Token inválido' }); }

    // Só o dono do bolão paga a assinatura dele.
    const memberSnap = await db.collection('tenants').doc(tenantId).collection('members').doc(decoded.uid).get();
    if (!memberSnap.exists || memberSnap.data().role !== 'owner') {
      return res.status(403).json({ error: 'Ação restrita ao dono do bolão' });
    }

    const tenantRef = db.collection('tenants').doc(tenantId);
    const tenantSnap = await tenantRef.get();
    if (!tenantSnap.exists) return res.status(404).json({ error: 'Bolão não encontrado' });
    const tenant = tenantSnap.data();
    const sub = tenant.subscription || trialSubscription();

    const appId = (process.env.LIONTECH_WOOVI_APP_ID || '').trim();
    if (!appId) {
      return res.status(503).json({ error: 'Cobrança da assinatura ainda não configurada na plataforma.' });
    }

    const valueInCents = Number(sub.priceCents) || PROMO_PRICE_CENTS;
    // O tenant vai no correlationID porque é por ele que o webhook descobre
    // qual bolão renovar.
    const correlationID = `assinatura_${tenantId}_${Date.now()}`;

    const wooviRes = await axios.post(`${WOOVI_API}/charge`, {
      correlationID,
      value: valueInCents,
      comment: `Assinatura mensal - ${String(tenant.name || tenantId)}`
        .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '').slice(0, 100),
      expiresIn: 3600,
    }, {
      headers: { Authorization: appId, 'Content-Type': 'application/json' },
      timeout: 15000,
      validateStatus: () => true,
    });

    if (wooviRes.status >= 400 || !wooviRes.data?.charge) {
      console.error('billing/subscribe: Woovi', wooviRes.status, wooviRes.data);
      return res.status(502).json({ error: 'Não foi possível gerar a cobrança agora. Tente novamente.' });
    }

    const charge = wooviRes.data.charge;
    await tenantRef.update({ 'subscription.pendingChargeId': correlationID });

    return res.status(200).json({
      correlationID,
      qrCodeImage: charge.qrCodeImage,
      brCode: charge.brCode || charge.pixKey,
      value: valueInCents,
      expiresAt: charge.expiresAt || null,
      status: evaluateStatus(sub),
      accessEndsAt: accessEndsAt(sub),
    });
  } catch (err) {
    console.error('billing/subscribe:', err.message);
    return res.status(500).json({ error: 'Erro ao gerar a cobrança da assinatura' });
  }
}
