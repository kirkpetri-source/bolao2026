// Traz as rodadas do Brasileirão para o bolão do organizador.
//
// Existe porque o botão do painel chamava /api/cron/sync-rounds direto, sem o
// segredo do cron: recebia 401, e como a resposta não tinha `logs` a tela ainda
// exibia "Sync concluído!". O organizador via sucesso e nada acontecia.
import { getAdminAuth, getAdminDb } from '../_shared/firebaseAdmin.js';
import { seedRoundsForTenant } from '../_shared/seedRounds.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { idToken, tenantId } = req.body || {};
    if (!idToken || !tenantId) return res.status(400).json({ error: 'Parâmetros: idToken, tenantId' });

    const db = getAdminDb();

    let decoded;
    try { decoded = await getAdminAuth().verifyIdToken(idToken); }
    catch { return res.status(401).json({ error: 'Token inválido' }); }

    const quem = await db.collection('users').doc(decoded.uid).get();
    const adminGlobal = quem.exists && quem.data().isAdmin === true;
    if (!adminGlobal) {
      const membro = await db.collection('tenants').doc(tenantId).collection('members').doc(decoded.uid).get();
      if (!membro.exists || membro.data().role !== 'owner') {
        return res.status(403).json({ error: 'Ação restrita ao dono do bolão' });
      }
    }

    const { criadas, motivo } = await seedRoundsForTenant(db, tenantId);

    if (criadas > 0) {
      return res.status(200).json({ criadas, mensagem: `${criadas} rodada(s) trazidas para o seu bolão.` });
    }
    return res.status(200).json({
      criadas: 0,
      mensagem: motivo === 'o bolão já tem rodadas'
        ? 'Suas rodadas já estão em dia. Novos jogos entram automaticamente todos os dias.'
        : `Nenhuma rodada foi trazida: ${motivo}.`,
    });
  } catch (err) {
    console.error('rounds/sync:', err.message);
    return res.status(500).json({ error: 'Erro ao buscar as rodadas' });
  }
}
