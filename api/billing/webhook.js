// Webhook da conta Woovi da LION TECH — confirma a mensalidade e devolve o
// bolão para ativo. Separado de api/payments/woovi-webhook.js porque aquele
// atende a conta de cada organizador, e são credenciais diferentes.
import axios from 'axios';
import { getAdminDb, FieldValue } from '../_shared/firebaseAdmin.js';
import { getSettings, sendWhatsApp, formatPhone } from '../_shared/firebase.js';
import { DEFAULT_TENANT_ID } from '../_shared/tenant.js';
import { STATUS, renewedPeriodEnd, trialSubscription } from '../_shared/subscription.js';
import { sendEmail, layoutEmail } from '../_shared/email.js';

// Confere na API em vez de confiar no corpo do webhook: qualquer um consegue
// fazer um POST aqui, mas ninguém forja um pagamento aprovado na Woovi.
async function confirmarNaWoovi(correlationID, appId) {
  const r = await axios.get(`https://api.woovi.com/api/v1/charge/${encodeURIComponent(correlationID)}`, {
    headers: { Authorization: appId },
    timeout: 8000,
    validateStatus: () => true,
  });

  // 401/403 aqui não é "não pago", é credencial sem permissão de LEITURA de
  // cobrança. Tratar como não pago deixaria todo cliente que pagasse sem
  // ativação, sem nenhum sinal de erro — separar o caso é o que torna esse
  // problema de configuração visível no log.
  if (r.status === 401 || r.status === 403) {
    console.error(
      `billing/webhook: CREDENCIAL SEM PERMISSAO DE LEITURA (HTTP ${r.status}). ` +
      'A API key da Woovi precisa do escopo CHARGE_GET, senao nenhum pagamento e confirmado. ' +
      `correlationID=${correlationID}`
    );
    return false;
  }
  if (r.status >= 400) {
    console.error(`billing/webhook: consulta falhou (HTTP ${r.status}) correlationID=${correlationID}`);
    return false;
  }
  return r.data?.charge?.status === 'COMPLETED';
}

export default async function handler(req, res) {
  // Sempre 200: a Woovi reenvia indefinidamente diante de erro, e um bug nosso
  // não deve virar uma fila de reentregas.
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const event = req.body || {};
    const tipo = event.event || event.type;
    if (!['OPENPIX:CHARGE_COMPLETED', 'CHARGE_COMPLETED'].includes(tipo)) {
      return res.status(200).json({ received: true });
    }

    const correlationID = event.charge?.correlationID || '';
    // Formato gravado em billing/subscribe: assinatura_{tenantId}_{timestamp}
    const m = /^assinatura_(.+)_\d{13}$/.exec(correlationID);
    if (!m) {
      console.log('billing/webhook: correlationID fora do padrão de assinatura:', correlationID);
      return res.status(200).json({ received: true });
    }
    const tenantId = m[1];

    const appId = (process.env.LIONTECH_WOOVI_APP_ID || '').trim();
    if (!appId) {
      console.error('billing/webhook: LIONTECH_WOOVI_APP_ID ausente — pagamento não confirmado');
      return res.status(200).json({ received: true });
    }
    if (!(await confirmarNaWoovi(correlationID, appId))) {
      console.error('billing/webhook: pagamento não confirmado:', correlationID);
      return res.status(200).json({ received: true });
    }

    const db = getAdminDb();
    const ref = db.collection('tenants').doc(tenantId);
    const snap = await ref.get();
    if (!snap.exists) {
      console.error('billing/webhook: bolão inexistente:', tenantId);
      return res.status(200).json({ received: true });
    }

    const tenant = snap.data();
    const sub = tenant.subscription || trialSubscription();

    // Reentrega da mesma cobrança não pode somar outro mês.
    if (sub.lastChargeId === correlationID) {
      return res.status(200).json({ received: true, jaProcessado: true });
    }

    const novoFim = renewedPeriodEnd(sub);
    await ref.update({
      'subscription.status': STATUS.ACTIVE,
      'subscription.currentPeriodEnd': novoFim,
      'subscription.lastChargeId': correlationID,
      'subscription.pendingChargeId': null,
      'subscription.blockedAt': null,
      'subscription.lastNotifiedAt': null,
      plan: 'ativo',
      updatedAt: FieldValue.serverTimestamp(),
    });

    const ate = new Date(novoFim).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const nome = tenant.name || 'seu bolão';

    const destino = formatPhone(tenant.ownerWhatsapp || '');
    if (destino) {
      const texto = `✅ *Assinatura confirmada!*\n\nO ${nome} está ativo até ${ate}.\n\nObrigado!`;
      try {
        await sendWhatsApp(destino, texto, await getSettings(DEFAULT_TENANT_ID));
      } catch (e) {
        console.error('billing/webhook: WhatsApp falhou:', e.message);
      }
    }

    if (tenant.ownerEmail) {
      const r = await sendEmail({
        to: tenant.ownerEmail,
        subject: `${nome}: assinatura confirmada`,
        html: layoutEmail({
          titulo: 'Pagamento confirmado',
          paragrafos: [
            `O <strong>${nome}</strong> está ativo até <strong>${ate}</strong>.`,
            'As ferramentas do painel foram liberadas e os participantes já podem enviar palpites.',
          ],
        }),
        // Uma confirmação por cobrança, mesmo que a Woovi reentregue o evento.
        idempotencyKey: `assinatura-confirmada/${correlationID}`,
      });
      if (!r.ok) console.error('billing/webhook: e-mail falhou:', r.motivo);
    }

    console.log(`billing/webhook: ${tenantId} ativo até ${new Date(novoFim).toISOString()}`);
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('billing/webhook:', err.message);
    return res.status(200).json({ received: true });
  }
}
