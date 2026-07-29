// Liga/desliga a aparição do bolão na lista pública da página inicial.
//
// Existe porque bolão de empresa, de família ou de grupo fechado não deveria
// ficar num catálogo aberto — mas o organizador precisa poder decidir isso, e
// o campo mora no doc do tenant, que o cliente não escreve.
import { getAdminAuth, getAdminDb, FieldValue } from '../_shared/firebaseAdmin.js';
import { isPlatformAdmin } from '../_shared/roles.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { idToken, tenantId, listado } = req.body || {};
    if (!idToken || !tenantId || typeof listado !== 'boolean') {
      return res.status(400).json({ error: 'Parâmetros: idToken, tenantId, listado (booleano)' });
    }

    const db = getAdminDb();

    let decoded;
    try { decoded = await getAdminAuth().verifyIdToken(idToken); }
    catch { return res.status(401).json({ error: 'Token inválido' }); }

    if (!(await isPlatformAdmin(db, decoded))) {
      const membro = await db.collection('tenants').doc(tenantId).collection('members').doc(decoded.uid).get();
      if (!membro.exists || membro.data().role !== 'owner') {
        return res.status(403).json({ error: 'Ação restrita ao dono do bolão' });
      }
    }

    await db.collection('tenants').doc(tenantId).update({
      listadoPublicamente: listado,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return res.status(200).json({ listado });
  } catch (err) {
    console.error('tenants/listing:', err.message);
    return res.status(500).json({ error: 'Erro ao salvar a preferência' });
  }
}
