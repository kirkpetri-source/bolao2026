// "Esqueci minha senha": o usuário informa o WhatsApp; geramos uma senha
// temporária e enviamos por WhatsApp (canal já integrado). Usa Admin SDK.
import crypto from 'crypto';
import { getAdminAuth } from '../_shared/firebaseAdmin.js';
import { db, getSettings, sendWhatsApp, formatPhone } from '../_shared/firebase.js';

function normWpp(s) {
  const d = String(s || '').replace(/\D/g, '');
  return d.length > 11 ? d.slice(-11) : d;
}
function tempPassword() {
  // 8 caracteres de um alfabeto sem ambiguidade (sem 0/O, 1/I/l).
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const phone = normWpp((req.body || {}).whatsapp);
    if (!phone) return res.status(400).json({ error: 'Informe o WhatsApp' });

    const snap = await db.collection('users').where('whatsapp', '==', phone).limit(1).get();
    // Resposta genérica: não revela se o número existe.
    if (snap.empty) return res.status(200).json({ ok: true });

    const userDoc = snap.docs[0];
    const temp = tempPassword();
    await getAdminAuth().updateUser(userDoc.id, { password: temp });

    const settings = await getSettings();
    const num = formatPhone(userDoc.data().whatsapp || phone);
    const name = userDoc.data().name || '';
    const msg = `*Bolão Brasileirão — Redefinição de senha*\n\nOlá${name ? `, ${name}` : ''}! Sua nova senha temporária é:\n\n${temp}\n\nDigite exatamente como acima (diferencia maiúsculas). Entre com ela e troque a senha em seguida.`;
    const sent = await sendWhatsApp(num, msg, settings);

    return res.status(200).json({ ok: true, sent });
  } catch (err) {
    console.error('forgot-password:', err.message);
    return res.status(500).json({ error: 'Erro ao redefinir senha' });
  }
}
