import axios from 'axios';
import { db, getSettings } from '../_shared/firebase.js';
import { doc, getDoc } from '../_shared/firestore.js';
import { DEFAULT_TENANT_ID } from '../_shared/tenant.js';

const WOOVI_API = 'https://api.openpix.com.br/api/v1';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { userId, roundId, cartelaCode, amount, correlationID: customCorrelationID } = req.body;
  if (!userId || !roundId || !cartelaCode) {
    return res.status(400).json({ error: 'Parâmetros obrigatórios: userId, roundId, cartelaCode' });
  }

  try {
    // O tenant sai da rodada, nunca do corpo da requisição: é ele que decide
    // para qual conta Woovi o dinheiro vai, então não pode vir do cliente.
    const roundSnap = await getDoc(doc(db, 'rounds', roundId));
    if (!roundSnap.exists()) {
      return res.status(404).json({ error: 'Rodada não encontrada' });
    }
    const round = roundSnap.data();
    const tenantId = round.tenantId || DEFAULT_TENANT_ID;
    const roundName = round.name || `Rodada ${roundId}`;

    const settings = await getSettings(tenantId);
    // O fallback de env só vale para o bolão original; um tenant novo sem Woovi
    // configurado precisa falhar, e não cair na conta de outro organizador.
    const appId = settings?.woovi?.appId
      || (tenantId === DEFAULT_TENANT_ID ? process.env.WOOVI_APP_ID : '');

    if (!appId) {
      return res.status(400).json({ error: 'Woovi não configurado. Adicione o App ID nas configurações.' });
    }

    // Usar valor das settings ou do body
    const betValue = amount || settings?.betValue || 15;
    const valueInCents = Math.round(parseFloat(betValue) * 100);

    // Criar cobrança na Woovi
    const payload = {
      correlationID: customCorrelationID || cartelaCode,
      value: valueInCents,
      comment: `Bolao Brasileirao 2026 - ${roundName} - ${cartelaCode}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, ''),
      expiresIn: 1800 // 30 minutos
    };

    const wooviRes = await axios.post(`${WOOVI_API}/charge`, payload, {
      headers: {
        Authorization: appId,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    const charge = wooviRes.data?.charge;
    if (!charge) {
      return res.status(502).json({ error: 'Woovi não retornou dados da cobrança.' });
    }

    return res.status(200).json({
      success: true,
      chargeId: charge.correlationID || charge.globalID,
      qrCodeImage: charge.qrCodeImage,
      brCode: charge.brCode || charge.pixKey,
      expiresAt: charge.expiresAt || new Date(Date.now() + 3600000).toISOString(),
      value: betValue
    });
  } catch (err) {
    const errData = err.response?.data;
    console.error('woovi-charge error:', errData || err.message);
    return res.status(err.response?.status || 500).json({
      error: 'Erro ao criar cobrança Woovi',
      details: errData?.error || err.message
    });
  }
}
