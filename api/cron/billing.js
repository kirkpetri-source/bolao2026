// Avalia diariamente a assinatura de cada bolão: avisa quem está perto de
// vencer, marca vencidos e bloqueia quem passou da cortesia. O bloqueio em si é
// aplicado pelas regras do Firestore e pelo painel, que leem tenants/{id}.subscription.
import { getAdminDb, FieldValue } from '../_shared/firebaseAdmin.js';
import { getSettings, sendWhatsApp, formatPhone } from '../_shared/firebase.js';
import { DEFAULT_TENANT_ID } from '../_shared/tenant.js';
import {
  STATUS, GRACE_DAYS, evaluateStatus, accessEndsAt, daysUntil, trialSubscription,
} from '../_shared/subscription.js';
import { sendEmail, layoutEmail } from '../_shared/email.js';

// Só avisa uma vez por dia por bolão, para o organizador não receber a mesma
// mensagem a cada execução do cron.
const NOTIFY_COOLDOWN_MS = 20 * 60 * 60 * 1000;

function realMoney(cents) {
  return (Number(cents || 0) / 100).toFixed(2).replace('.', ',');
}

function mensagem(tenantName, status, sub, now) {
  const valor = realMoney(sub.priceCents);
  const fim = accessEndsAt(sub);
  if (status === STATUS.BLOCKED) {
    return `🔒 *${tenantName} — acesso bloqueado*\n\nA mensalidade da plataforma (R$ ${valor}) segue em aberto, e o período de cortesia terminou.\n\nO seu painel está travado e os participantes não conseguem enviar palpites até a regularização.\n\nAssim que o pagamento for confirmado, tudo volta automaticamente.`;
  }
  if (status === STATUS.OVERDUE) {
    const restam = Math.max(0, GRACE_DAYS - Math.abs(daysUntil(fim, now)));
    return `⚠️ *${tenantName} — mensalidade vencida*\n\nA mensalidade da plataforma (R$ ${valor}) venceu.\n\nO bolão continua funcionando por mais ${restam} dia(s). Depois disso o painel trava e os participantes ficam impedidos de palpitar.`;
  }
  const faltam = daysUntil(fim, now);
  return `🏆 *${tenantName}*\n\nSeu período de teste termina em ${faltam} dia(s).\n\nPara manter o bolão no ar, assine por R$ ${valor}/mês. Sem isso, o painel trava e os participantes não conseguem palpitar.`;
}

// Mesmo conteúdo do WhatsApp, em prosa — sem asterisco de negrito nem emoji,
// que num e-mail parecem erro de formatação.
function emailDoAviso(tenantName, status, sub, now) {
  const valor = realMoney(sub.priceCents);
  const fim = accessEndsAt(sub);
  const painel = 'https://bolao-brasileirao-2025-dev.vercel.app';
  const botao = { url: painel, texto: 'Abrir o painel e pagar' };

  if (status === STATUS.BLOCKED) {
    return {
      subject: `${tenantName}: bolão bloqueado por falta de pagamento`,
      html: layoutEmail({
        titulo: 'Seu bolão está bloqueado',
        paragrafos: [
          `A mensalidade da plataforma, de <strong>R$ ${valor}</strong>, segue em aberto e o período de cortesia terminou.`,
          'Você continua entrando no painel e vendo o histórico, mas não consegue abrir rodadas, e os participantes não conseguem enviar palpites.',
          'Assim que o pagamento for confirmado, tudo volta automaticamente.',
        ],
        botao,
      }),
    };
  }
  if (status === STATUS.OVERDUE) {
    const restam = Math.max(0, GRACE_DAYS - Math.abs(daysUntil(fim, now)));
    return {
      subject: `${tenantName}: mensalidade vencida`,
      html: layoutEmail({
        titulo: 'Sua mensalidade venceu',
        paragrafos: [
          `A mensalidade da plataforma, de <strong>R$ ${valor}</strong>, venceu.`,
          `O bolão continua funcionando por mais <strong>${restam} dia(s)</strong>. Depois disso o painel trava e os participantes ficam impedidos de palpitar.`,
        ],
        botao,
      }),
    };
  }
  const faltam = daysUntil(fim, now);
  return {
    subject: `${tenantName}: faltam ${faltam} dia(s) de teste`,
    html: layoutEmail({
      titulo: `Faltam ${faltam} dia(s) do seu teste`,
      paragrafos: [
        `Para manter o bolão no ar depois do teste, assine por <strong>R$ ${valor}/mês</strong>.`,
        'Sem a assinatura, o painel trava e os participantes não conseguem palpitar.',
      ],
      botao,
    }),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Mesma proteção dos demais crons: sem segredo configurado, ninguém entra.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getAdminDb();
  const now = Date.now();
  const logs = [];

  try {
    const snap = await db.collection('tenants').get();

    for (const docSnap of snap.docs) {
      const tenantId = docSnap.id;
      const tenant = docSnap.data();

      // O bolão original é da própria Lion Tech: não se cobra de si mesmo.
      if (tenantId === DEFAULT_TENANT_ID) continue;

      // Tenant sem assinatura — ou com uma sem datas, como acontece quando uma
      // cobrança é gerada antes do primeiro ciclo do cron — ganha um teste
      // a partir de agora. Checar só a existência do campo deixaria um
      // subscription pela metade passar batido e virar dias negativos.
      const semPeriodo = !accessEndsAt(tenant.subscription);
      const sub = semPeriodo
        ? { ...(tenant.subscription || {}), ...trialSubscription(now) }
        : tenant.subscription;
      const novo = evaluateStatus(sub, now);
      const mudou = novo !== sub.status;

      const patch = {};
      if (mudou) {
        patch['subscription.status'] = novo;
        if (novo === STATUS.BLOCKED) patch['subscription.blockedAt'] = now;
      }
      if (semPeriodo) patch.subscription = sub;

      // Avisa em toda transição e, fora dela, quando falta pouco para vencer.
      const faltam = daysUntil(accessEndsAt(sub), now);
      const perto = novo === STATUS.TRIAL && faltam <= 2;
      const jaAvisouHoje = now - Number(sub.lastNotifiedAt || 0) < NOTIFY_COOLDOWN_MS;
      const avisar = (mudou || perto) && !jaAvisouHoje;

      if (avisar) {
        const texto = mensagem(tenant.name || 'Seu bolão', novo, sub, now);
        // O aviso vai pelo WhatsApp da plataforma (bolão padrão), não pela
        // instância do cliente: se ele está bloqueado, a dele pode estar parada.
        const plataforma = await getSettings(DEFAULT_TENANT_ID);
        const destino = formatPhone(tenant.ownerWhatsapp || '');
        if (destino) {
          try {
            await sendWhatsApp(destino, texto, plataforma);
            patch['subscription.lastNotifiedAt'] = now;
            logs.push(`${tenantId}: avisado (${novo}) via WhatsApp`);
          } catch (e) {
            logs.push(`${tenantId}: falha no WhatsApp — ${e.message}`);
          }
        } else {
          logs.push(`${tenantId}: sem WhatsApp do organizador, aviso não enviado`);
        }

        // E-mail em paralelo: o organizador pode ter trocado de número, e um
        // aviso de cobrança perdido vira cancelamento.
        if (tenant.ownerEmail) {
          const { subject, html } = emailDoAviso(tenant.name || 'Seu bolão', novo, sub, now);
          const hoje = new Date(now).toISOString().slice(0, 10);
          const r = await sendEmail({
            to: tenant.ownerEmail,
            subject,
            html,
            // Se o cron reexecutar no mesmo dia, a Resend devolve o envio
            // original em vez de mandar de novo.
            idempotencyKey: `cobranca-${novo}/${tenantId}-${hoje}`,
          });
          if (r.ok) {
            patch['subscription.lastNotifiedAt'] = now;
            logs.push(`${tenantId}: avisado (${novo}) por e-mail`);
          } else {
            logs.push(`${tenantId}: e-mail falhou — ${r.motivo}`);
          }
        } else {
          logs.push(`${tenantId}: sem e-mail do organizador cadastrado`);
        }
      }

      if (Object.keys(patch).length) {
        patch.updatedAt = FieldValue.serverTimestamp();
        await docSnap.ref.update(patch);
      }
      if (mudou) logs.push(`${tenantId}: ${sub.status} → ${novo}`);
    }

    return res.status(200).json({ ok: true, avaliados: snap.size, logs });
  } catch (err) {
    console.error('cron/billing:', err);
    return res.status(500).json({ error: err.message, logs });
  }
}
