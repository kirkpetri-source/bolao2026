import { db, getSettings, formatPhone } from '../_shared/firebase.js';
import { doc, updateDoc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';

async function sendWhatsAppMessage(number, text, settings) {
  try {
    const { default: axios } = await import('axios');
    const cfg = settings?.devolution || {};
    const link = cfg.link || process.env.EVOLUTION_LINK;
    const instance = cfg.instanceName || process.env.EVOLUTION_INSTANCE;
    const token = cfg.token || process.env.EVOLUTION_TOKEN;

    if (!link || !instance || !token) return false;

    const base = link.trim().replace(/\/$/, '').replace(/\.$/, '');
    const url = `${base}/message/sendText/${encodeURIComponent(instance.trim())}`;

    await axios.post(url, { number, text }, {
      headers: { 'Content-Type': 'application/json', apikey: token },
      timeout: 10000
    });
    return true;
  } catch (error) {
    console.error('Error sending WhatsApp:', JSON.stringify(error.response?.data || error.message));
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { userId, roundId, cartelaCode } = req.body;

  if (!userId || !roundId) {
    return res.status(400).json({ error: 'Faltam parâmetros: userId ou roundId' });
  }

  try {
    let q = query(
      collection(db, 'predictions'),
      where('userId', '==', userId),
      where('roundId', '==', roundId)
    );

    if (cartelaCode) {
      q = query(q, where('cartelaCode', '==', cartelaCode));
    }

    const predictionsSnap = await getDocs(q);

    if (predictionsSnap.empty) {
      return res.status(404).json({ error: `Nenhum palpite encontrado para pagar. Buscado: userId=${userId}, roundId=${roundId}, cartelaCode=${cartelaCode}` });
    }

    for (const docSnap of predictionsSnap.docs) {
      await updateDoc(docSnap.ref, {
        paid: true,
        statusPagamento: 'pago',
        dataPagamento: new Date().toISOString()
      });
    }

    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      const userData = userSnap.data();
      const userPhone = formatPhone(userData.phone || userData.whatsapp);

      if (userPhone) {
        const settings = await getSettings();
        const cartelaTexto = cartelaCode ? ` (Cartela: ${cartelaCode})` : '';
        const msg = `*Bolão Brasileirão - Pagamento Confirmado!*\n\nOlá, ${userData.name}! Seu pagamento via PIX${cartelaTexto} foi confirmado e seus palpites já estão valendo no ranking. Boa sorte! 🍀`;
        await sendWhatsAppMessage(userPhone, msg, settings);
      }
    }

    return res.status(200).json({ success: true, message: 'Pagamento simulado e cartela confirmada' });
  } catch (error) {
    console.error('Erro ao processar PIX simulado:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
