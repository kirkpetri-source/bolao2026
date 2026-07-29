// Liga e desliga a cobrança recorrente da mensalidade (Pix Automático da Woovi).
// Ligada, a Woovi gera as parcelas sozinha no ciclo; desligada, o organizador
// segue pagando pelo botão avulso de api/billing/subscribe.js.
import axios from 'axios';
import { getAdminAuth, getAdminDb, FieldValue } from '../_shared/firebaseAdmin.js';
import { trialSubscription, PROMO_PRICE_CENTS } from '../_shared/subscription.js';
import { isTaxIdValido, normalizeTaxId, mascaraTaxId } from '../_shared/taxid.js';

const WOOVI_API = 'https://api.openpix.com.br/api/v1';

function woovi(appId) {
  return axios.create({
    baseURL: WOOVI_API,
    headers: { Authorization: appId, 'Content-Type': 'application/json' },
    timeout: 20000,
    validateStatus: () => true,
  });
}

// A Woovi aceita de 0 a 27 — dias 28 a 31 não existem em todo mês, e uma
// assinatura criada dia 30 ficaria sem data válida em fevereiro.
function diaDeCobranca(now = new Date()) {
  return Math.min(now.getDate(), 27);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { idToken, tenantId, enabled, taxID } = req.body || {};
    if (!idToken || !tenantId || typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Parâmetros: idToken, tenantId, enabled (booleano)' });
    }

    const db = getAdminDb();

    let decoded;
    try { decoded = await getAdminAuth().verifyIdToken(idToken); }
    catch { return res.status(401).json({ error: 'Token inválido' }); }

    const membro = await db.collection('tenants').doc(tenantId).collection('members').doc(decoded.uid).get();
    if (!membro.exists || membro.data().role !== 'owner') {
      return res.status(403).json({ error: 'Ação restrita ao dono do bolão' });
    }

    const ref = db.collection('tenants').doc(tenantId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Bolão não encontrado' });
    const tenant = snap.data();
    const sub = tenant.subscription || trialSubscription();

    const appId = (process.env.LIONTECH_WOOVI_APP_ID || '').trim();
    if (!appId) return res.status(503).json({ error: 'Cobrança não configurada na plataforma.' });
    const api = woovi(appId);

    // ── Desligar ──────────────────────────────────────────────────────────────
    if (!enabled) {
      const id = sub.wooviSubscriptionId;
      if (id) {
        const r = await api.put(`/subscriptions/${encodeURIComponent(id)}/cancel`);
        // Assinatura já cancelada ou inexistente não é erro para o organizador:
        // o que ele pediu — parar de cobrar — está satisfeito de qualquer forma.
        if (r.status >= 400 && r.status !== 404) {
          console.error('billing/recurrence: cancelamento falhou', r.status, r.data);
          return res.status(502).json({ error: 'Não foi possível cancelar a recorrência agora. Tente novamente.' });
        }
      }
      await ref.update({
        'subscription.recurring': false,
        'subscription.wooviSubscriptionId': null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ recurring: false });
    }

    // ── Ligar ─────────────────────────────────────────────────────────────────
    const doc = normalizeTaxId(taxID || sub.taxID);
    if (!isTaxIdValido(doc)) {
      return res.status(400).json({ error: 'Informe um CPF ou CNPJ válido para ativar a cobrança recorrente.' });
    }
    if (!tenant.ownerEmail) {
      return res.status(400).json({ error: 'Cadastre um e-mail no bolão antes de ativar a recorrência.' });
    }

    if (sub.wooviSubscriptionId) {
      return res.status(200).json({ recurring: true, jaAtiva: true, subscriptionId: sub.wooviSubscriptionId });
    }

    const r = await api.post('/subscriptions', {
      value: Number(sub.priceCents) || PROMO_PRICE_CENTS,
      dayGenerateCharge: diaDeCobranca(),
      customer: {
        name: String(tenant.name || 'Organizador').slice(0, 60),
        taxID: doc,
        email: tenant.ownerEmail,
        phone: String(tenant.ownerWhatsapp || '').replace(/\D/g, ''),
      },
    });

    if (r.status >= 400) {
      console.error('billing/recurrence: criação falhou', r.status, JSON.stringify(r.data).slice(0, 300));
      const detalhe = r.data?.errors?.[0]?.message || r.data?.error || null;
      return res.status(502).json({ error: 'Não foi possível ativar a recorrência.', detalhe });
    }

    const criada = r.data?.subscription || r.data || {};
    const subscriptionId = criada.globalID || criada.id || null;
    if (!subscriptionId) {
      console.error('billing/recurrence: resposta sem identificador', JSON.stringify(r.data).slice(0, 300));
      return res.status(502).json({ error: 'A Woovi não devolveu o identificador da assinatura.' });
    }

    await ref.update({
      subscription: {
        ...sub,
        recurring: true,
        wooviSubscriptionId: subscriptionId,
        taxID: doc,
      },
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(`billing/recurrence: ${tenantId} recorrência ativa (doc ${mascaraTaxId(doc)})`);
    return res.status(200).json({
      recurring: true,
      subscriptionId,
      dayGenerateCharge: diaDeCobranca(),
      // A autorização do débito é feita pelo pagador no app do banco dele.
      pixAutomatico: criada.pixAutomatic ?? criada.automatic ?? null,
    });
  } catch (err) {
    console.error('billing/recurrence:', err.message);
    return res.status(500).json({ error: 'Erro ao configurar a recorrência' });
  }
}
