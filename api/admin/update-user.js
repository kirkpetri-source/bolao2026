// Admin edita dados cadastrais e/ou senha de um usuário.
// Atualiza tanto o doc /users quanto a conta no Firebase Auth (email de login
// sintético derivado do WhatsApp e/ou senha). O email REAL é dado de contato,
// guardado apenas no doc. Usa Admin SDK e valida que o chamador é admin.
import { getAdminAuth, getAdminDb } from '../_shared/firebaseAdmin.js';

const EMAIL_DOMAIN = 'bolao.users';
function normWpp(s) {
  const d = String(s || '').replace(/\D/g, '');
  return d.length > 11 ? d.slice(-11) : d;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const { idToken, targetUserId, name, whatsapp, email, newPassword } = req.body || {};
    if (!idToken || !targetUserId) {
      return res.status(400).json({ error: 'Parâmetros obrigatórios: idToken, targetUserId' });
    }

    const auth = getAdminAuth();
    const db = getAdminDb();

    // Autoriza: o chamador precisa ser admin.
    let decoded;
    try { decoded = await auth.verifyIdToken(idToken); }
    catch { return res.status(401).json({ error: 'Token inválido' }); }

    const callerSnap = await db.collection('users').doc(decoded.uid).get();
    if (!callerSnap.exists || callerSnap.data().isAdmin !== true) {
      return res.status(403).json({ error: 'Ação restrita ao administrador' });
    }

    // Monta atualização da conta no Auth.
    const authUpdate = {};
    if (whatsapp) authUpdate.email = `${normWpp(whatsapp)}@${EMAIL_DOMAIN}`;
    if (newPassword) {
      if (String(newPassword).length < 6) return res.status(400).json({ error: 'Senha mínimo 6 caracteres' });
      authUpdate.password = newPassword;
    }
    if (Object.keys(authUpdate).length) {
      await auth.updateUser(targetUserId, authUpdate);
    }

    // Monta atualização do doc /users (dados cadastrais).
    const docUpdate = {};
    if (name !== undefined) docUpdate.name = name;
    if (whatsapp !== undefined) docUpdate.whatsapp = normWpp(whatsapp);
    if (email !== undefined) docUpdate.email = email;
    if (Object.keys(docUpdate).length) {
      await db.collection('users').doc(targetUserId).update(docUpdate);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('admin/update-user:', err.message);
    return res.status(500).json({ error: err.message || 'Erro ao atualizar usuário' });
  }
}
