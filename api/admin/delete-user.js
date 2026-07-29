// Exclui um participante por completo: vínculo de membro no tenant, doc /users
// e conta no Firebase Auth (libera o WhatsApp para novo cadastro). Antes disso
// a exclusão era só no Firestore e deixava a conta órfã no Auth, travando o
// número com "WhatsApp já cadastrado".
//
// Autorização: admin global OU owner do tenant informado (e o alvo precisa ser
// membro desse tenant). Se o alvo ainda for membro de OUTRO tenant, remove só
// o vínculo — a conta global permanece.
import { getAdminAuth, getAdminDb } from '../_shared/firebaseAdmin.js';
import { releaseEmail } from '../_shared/emailIndex.js';
import { isPlatformAdmin } from '../_shared/roles.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const { idToken, targetUserId, tenantId } = req.body || {};
    if (!idToken || !targetUserId || !tenantId) {
      return res.status(400).json({ error: 'Parâmetros obrigatórios: idToken, targetUserId, tenantId' });
    }

    const auth = getAdminAuth();
    const db = getAdminDb();

    let decoded;
    try { decoded = await auth.verifyIdToken(idToken); }
    catch { return res.status(401).json({ error: 'Token inválido' }); }

    if (decoded.uid === targetUserId) {
      return res.status(400).json({ error: 'Não é possível excluir a própria conta por aqui' });
    }

    // Autoriza: quem opera a plataforma OU o dono do bolão.
    const isGlobalAdmin = await isPlatformAdmin(db, decoded);
    let isTenantOwner = false;
    if (!isGlobalAdmin) {
      const callerMem = await db.collection('tenants').doc(tenantId).collection('members').doc(decoded.uid).get();
      isTenantOwner = callerMem.exists && callerMem.data().role === 'owner';
    }
    if (!isGlobalAdmin && !isTenantOwner) {
      return res.status(403).json({ error: 'Ação restrita ao administrador do bolão' });
    }

    const targetMemRef = db.collection('tenants').doc(tenantId).collection('members').doc(targetUserId);
    const targetMem = await targetMemRef.get();
    if (!isGlobalAdmin && !targetMem.exists) {
      return res.status(403).json({ error: 'Usuário não pertence a este bolão' });
    }
    if (!isGlobalAdmin && targetMem.exists && targetMem.data().role === 'owner') {
      return res.status(403).json({ error: 'Não é possível excluir o dono do bolão' });
    }

    // Remove o vínculo neste tenant.
    if (targetMem.exists) await targetMemRef.delete();

    // Se ainda for membro de outro tenant, preserva a conta global.
    const tenantsSnap = await db.collection('tenants').get();
    let hasOtherMembership = false;
    for (const t of tenantsSnap.docs) {
      if (t.id === tenantId) continue;
      const m = await t.ref.collection('members').doc(targetUserId).get();
      if (m.exists) { hasOtherMembership = true; break; }
    }
    if (hasOtherMembership) {
      return res.status(200).json({ ok: true, removed: 'membership' });
    }

    // Sem outros vínculos: exclusão completa (doc + Auth + índice de e-mail).
    // O índice precisa cair junto, senão o e-mail continua reservado e a pessoa
    // não consegue se cadastrar de novo — o mesmo tipo de trava que a conta
    // órfã no Auth causava com o WhatsApp.
    const alvoSnap = await db.collection('users').doc(targetUserId).get();
    const emailDoAlvo = alvoSnap.exists ? alvoSnap.data().email : '';

    await db.collection('users').doc(targetUserId).delete();
    try { await auth.deleteUser(targetUserId); }
    catch (e) { if (e?.code !== 'auth/user-not-found') throw e; }
    if (emailDoAlvo) await releaseEmail(db, emailDoAlvo);

    return res.status(200).json({ ok: true, removed: 'account', emailLiberado: !!emailDoAlvo });
  } catch (err) {
    console.error('admin/delete-user:', err.message);
    return res.status(500).json({ error: err.message || 'Erro ao excluir usuário' });
  }
}
