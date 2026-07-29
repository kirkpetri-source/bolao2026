import { db, getSettings, sendWhatsApp, formatPhone } from '../_shared/firebase.js';
import { collection, getDocs, getDoc, doc, updateDoc, query, where } from '../_shared/firestore.js';
import { DEFAULT_TENANT_ID } from '../_shared/tenant.js';
import axios from 'axios';

// Verifica com a API da Woovi se a cobrança realmente foi paga
// Mais seguro que verificar header: não depende de algoritmo de assinatura
async function verifyChargeWithWoovi(correlationID, appId) {
  try {
    const res = await axios.get(`https://api.woovi.com/api/v1/charge/${encodeURIComponent(correlationID)}`, {
      headers: { Authorization: appId },
      timeout: 8000
    });
    const status = res.data?.charge?.status;
    console.log(`woovi-webhook: verificação API — correlationID=${correlationID} status=${status}`);
    return status === 'COMPLETED';
  } catch (err) {
    console.error('woovi-webhook: erro ao verificar cobrança na API:', err.message);
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const event = req.body;
    const eventType = event?.event || event?.type;

    if (!['OPENPIX:CHARGE_COMPLETED', 'CHARGE_COMPLETED'].includes(eventType)) {
      console.log('woovi-webhook: evento ignorado:', eventType);
      return res.status(200).json({ received: true });
    }

    const charge = event?.charge;
    const correlationID = charge?.correlationID;

    if (!correlationID) {
      console.error('woovi-webhook: correlationID ausente');
      return res.status(200).json({ received: true });
    }

    // Suporte a retry: "CARTELA-001_1747313045123" → "CARTELA-001"
    const cartelaCode = correlationID.replace(/_\d{13}$/, '');

    // As cartelas vêm primeiro porque é delas que sai o tenant — e o tenant
    // decide qual credencial Woovi valida a cobrança e qual WhatsApp notifica.
    const predsSnap = await getDocs(
      query(collection(db, 'predictions'), where('cartelaCode', '==', cartelaCode))
    );

    if (predsSnap.empty) {
      console.error(`woovi-webhook: cartelaCode não encontrado: ${cartelaCode}`);
      return res.status(200).json({ received: true });
    }

    const tenantId = predsSnap.docs[0].data().tenantId || DEFAULT_TENANT_ID;
    // Código de cartela é único por bolão, não globalmente: confirmar duas
    // cartelas homônimas de tenants diferentes daria baixa no pagamento errado.
    const tenantPreds = predsSnap.docs.filter(d => (d.data().tenantId || DEFAULT_TENANT_ID) === tenantId);

    const settings = await getSettings(tenantId);
    const appId = settings?.woovi?.appId
      || (tenantId === DEFAULT_TENANT_ID ? process.env.WOOVI_APP_ID : '');

    // Verificar pagamento direto na API da Woovi (mais seguro que assinatura de header)
    const isPaid = await verifyChargeWithWoovi(correlationID, appId);
    if (!isPaid) {
      console.error(`woovi-webhook: cobrança não confirmada pela API. correlationID=${correlationID}`);
      return res.status(200).json({ received: true });
    }

    // Se todas já estão pagas, é uma reentrega do Woovi — ignorar para não duplicar WhatsApp
    const jaProcessado = tenantPreds.every(d => d.data().paid === true);
    if (jaProcessado) {
      console.log(`woovi-webhook: já processado para ${cartelaCode}, ignorando reentrega`);
      return res.status(200).json({ received: true });
    }

    let userId = null;
    for (const predDoc of tenantPreds) {
      await updateDoc(predDoc.ref, {
        paid: true,
        statusPagamento: 'pago',
        dataPagamento: new Date().toISOString(),
        wooviChargeId: charge?.globalID || correlationID,
        wooviCorrelationID: correlationID
      });
      if (!userId) userId = predDoc.data().userId;
    }

    // Notificação WhatsApp ao participante
    if (userId) {
      const userDoc = await getDoc(doc(db, 'users', userId));
      if (userDoc.exists()) {
        const user = userDoc.data();
        const phone = formatPhone(user.phone || user.whatsapp);
        if (phone) {
          const roundId = tenantPreds[0].data().roundId;
          const roundSnap = await getDoc(doc(db, 'rounds', roundId));
          const roundName = (roundSnap.exists() && roundSnap.data().name) || 'esta rodada';
          const msg = `✅ *Pagamento Confirmado!*\n\nOlá, ${user.name}! Seu PIX para a *${roundName}* (Cartela: ${cartelaCode}) foi confirmado. Seus palpites estão válidos. Boa sorte! 🍀`;
          await sendWhatsApp(phone, msg, settings);
        }
      }
    }

    console.log(`woovi-webhook: pago — cartelaCode=${cartelaCode} correlationID=${correlationID}`);
    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('woovi-webhook error:', err.message);
    return res.status(200).json({ received: true });
  }
}
