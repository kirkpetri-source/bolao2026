import axios from 'axios';
import { db, getSettings } from '../_shared/firebase.js';
import { collection, getDocs, query, where } from 'firebase/firestore';

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
    const settings = await getSettings();
    const appId = settings?.woovi?.appId || process.env.WOOVI_APP_ID;

    if (!appId) {
      return res.status(400).json({ error: 'Woovi não configurado. Adicione o App ID nas configurações.' });
    }

    // Usar valor das settings ou do body
    const betValue = amount || settings?.betValue || 15;
    const valueInCents = Math.round(parseFloat(betValue) * 100);

    // Buscar nome da rodada
    const roundsSnap = await getDocs(collection(db, 'rounds'));
    const roundDoc = roundsSnap.docs.find(d => d.id === roundId);
    const roundName = roundDoc?.data()?.name || `Rodada ${roundId}`;

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
