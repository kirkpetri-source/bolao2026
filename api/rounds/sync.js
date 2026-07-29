// Traz as rodadas do Brasileirão para o bolão do organizador.
//
// Existe porque o botão do painel chamava /api/cron/sync-rounds direto, sem o
// segredo do cron: recebia 401, e como a resposta não tinha `logs` a tela ainda
// exibia "Sync concluído!". O organizador via sucesso e nada acontecia.
import { getAdminAuth, getAdminDb } from '../_shared/firebaseAdmin.js';
import { seedRoundsForTenant } from '../_shared/seedRounds.js';
import { isPlatformAdmin } from '../_shared/roles.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { idToken, tenantId } = req.body || {};
    if (!idToken || !tenantId) return res.status(400).json({ error: 'Parâmetros: idToken, tenantId' });

    const db = getAdminDb();

    let decoded;
    try { decoded = await getAdminAuth().verifyIdToken(idToken); }
    catch { return res.status(401).json({ error: 'Token inválido' }); }

    const adminGlobal = await isPlatformAdmin(db, decoded);
    if (!adminGlobal) {
      const membro = await db.collection('tenants').doc(tenantId).collection('members').doc(decoded.uid).get();
      if (!membro.exists || membro.data().role !== 'owner') {
        return res.status(403).json({ error: 'Ação restrita ao dono do bolão' });
      }
    }

    const { criadas, emAndamento = [], motivo } = await seedRoundsForTenant(db, tenantId);

    // Avisa quais rodadas ficaram de fora por já estarem rolando. Sem isso o
    // organizador acha que o sistema esqueceu uma rodada — quando na verdade
    // ela foi barrada de propósito, para ninguém palpitar com o jogo em curso.
    const aviso = emAndamento.length
      ? ` A rodada ${emAndamento.join(', ')} não foi aberta porque os jogos dela já começaram — palpite com a partida em andamento seria injusto com quem apostou antes.`
      : '';

    if (criadas > 0) {
      return res.status(200).json({
        criadas, emAndamento,
        mensagem: `${criadas} rodada(s) futuras trazidas para o seu bolão.${aviso}`,
      });
    }
    return res.status(200).json({
      criadas: 0, emAndamento,
      mensagem: motivo === 'o bolão já tem rodadas'
        ? `Suas rodadas já estão em dia — novos jogos entram automaticamente todos os dias.${aviso}`
        : `Nenhuma rodada nova: ${motivo}.${aviso}`,
    });
  } catch (err) {
    console.error('rounds/sync:', err.message);
    return res.status(500).json({ error: 'Erro ao buscar as rodadas' });
  }
}
