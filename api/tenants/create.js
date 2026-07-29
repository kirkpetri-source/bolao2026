// Onboarding de organizador (Fase 3 do SaaS): cria a conta do dono no Auth,
// o tenant (bolão), o vínculo owner e a configuração inicial. Admin SDK
// (ignora as regras — a criação de tenants é exclusiva do backend).
import { getAdminDb, getAdminAuth, FieldValue } from '../_shared/firebaseAdmin.js';
import { DEFAULT_TENANT_ID } from '../_shared/tenant.js';
import { trialSubscription } from '../_shared/subscription.js';

const EMAIL_DOMAIN = 'bolao.users';

function normWpp(s) {
  const d = String(s || '').replace(/\D/g, '');
  return d.length > 11 ? d.slice(-11) : d;
}

function slugify(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'bolao';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  const db = getAdminDb();
  try {
    const body = req.body || {};
    const bolaoName = String(body.bolaoName || '').trim();
    const name = String(body.name || '').trim();
    const whatsapp = normWpp(body.whatsapp);
    const password = String(body.password || '');
    const pixKey = String(body.pixKey || '').trim();
    const betValue = Math.max(1, Number(body.betValue) || 15);
    // E-mail real do organizador — o login continua sendo pelo WhatsApp, este
    // endereço serve para os avisos de cobrança da assinatura.
    const email = String(body.email || '').trim().toLowerCase();

    if (bolaoName.length < 3) return res.status(400).json({ error: 'Nome do bolão muito curto (mínimo 3 letras)' });
    if (!name) return res.status(400).json({ error: 'Informe o nome do organizador' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Informe um e-mail válido para os avisos de cobrança' });
    if (whatsapp.length < 10) return res.status(400).json({ error: 'WhatsApp inválido (use DDD + número)' });
    if (password.length < 6) return res.status(400).json({ error: 'Senha mínimo 6 caracteres' });

    // Rate limit por IP: no máximo 3 criações a cada 30 minutos.
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    const RL_MAX = 3, RL_WINDOW_MS = 30 * 60 * 1000, now = Date.now();
    const rlRef = db.collection('rate_limits').doc('tenantcreate_' + ip.replace(/[^a-zA-Z0-9.:]/g, '_'));
    const rlSnap = await rlRef.get();
    let count = 0, windowStart = now;
    if (rlSnap.exists) {
      const d = rlSnap.data();
      if (now - (d.windowStart || 0) < RL_WINDOW_MS) { count = d.count || 0; windowStart = d.windowStart; }
    }
    if (count >= RL_MAX) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
    await rlRef.set({ count: count + 1, windowStart, updatedAt: now });

    // Slug único do tenant.
    let slug = slugify(bolaoName);
    if (slug === DEFAULT_TENANT_ID) slug = `${slug}-2`;
    for (let i = 2; (await db.collection('tenants').doc(slug).get()).exists; i++) {
      slug = `${slugify(bolaoName)}-${i}`;
    }

    // Conta do organizador no Auth (e-mail sintético do WhatsApp).
    let uid;
    try {
      const user = await getAdminAuth().createUser({
        email: `${whatsapp}@${EMAIL_DOMAIN}`,
        password,
        displayName: name,
      });
      uid = user.uid;
    } catch (e) {
      if (e?.code === 'auth/email-already-exists') {
        return res.status(409).json({ error: 'WhatsApp já cadastrado. Faça login com sua conta — em breve será possível criar um bolão a partir dela.' });
      }
      throw e;
    }

    try {
      const batch = db.batch();
      batch.set(db.collection('users').doc(uid), {
        name, whatsapp, email, isAdmin: false, balance: 0,
        lastTenantId: slug,
        createdAt: FieldValue.serverTimestamp(),
      });
      batch.set(db.collection('tenants').doc(slug), {
        name: bolaoName,
        ownerId: uid,
        ownerEmail: email,
        ownerWhatsapp: whatsapp,
        plan: 'trial',
        subscription: trialSubscription(),
        createdAt: FieldValue.serverTimestamp(),
      });
      batch.set(db.collection('tenants').doc(slug).collection('members').doc(uid), {
        role: 'owner', name,
        createdAt: FieldValue.serverTimestamp(),
      });
      batch.set(db.collection('settings').doc(), {
        tenantId: slug,
        brandName: bolaoName,
        betValue,
        whatsappMessage: '🏆 *{RODADA}*\n🎫 *Cartela: {CARTELA}*\n✅ Confirmado!\n\n{PALPITES}\n\n🏦 Pagamento via PIX\n🔑 Chave: {PIX}\n👤 Destinatário: {DESTINATARIO}\n\n💰 Valor: R$ {VALOR}\n⚠️ *Não pode alterar após pagamento*\n\nBoa sorte! 🍀',
        chargeMessageTemplate: 'Olá {NOME},\n\nO pagamento da sua cartela da {RODADA} ainda está pendente.\n\nValor: R$ {VALOR}\nCartela: {CARTELA}\n\nConclua o pagamento para validar sua participação no ranking e na premiação. Obrigado! 🙏',
        maintenanceMode: false,
        maintenanceMessage: '',
        maintenanceUntil: null,
        payment: { provider: 'pix_manual', pixKey, pixRecipientName: name, useEnvCredentials: false },
        devolution: { instanceName: '', link: '', token: '' },
        createdAt: FieldValue.serverTimestamp(),
      });
      batch.set(db.collection('public_config').doc(slug), {
        tenantId: slug,
        brandName: bolaoName,
        betValue,
        maintenanceMode: false,
        wooviEnabled: false,
        payment: { pixKey, pixRecipientName: name, methods: { pix: true, card: false } },
        whatsapp: { number: '', groupJid: '' },
      });
      await batch.commit();
    } catch (e) {
      // Não deixa conta órfã se a gravação falhar.
      try { await getAdminAuth().deleteUser(uid); } catch {}
      throw e;
    }

    return res.status(200).json({ ok: true, tenantId: slug });
  } catch (err) {
    console.error('tenants/create:', err);
    return res.status(500).json({ error: 'Erro ao criar o bolão. Tente novamente.' });
  }
}
