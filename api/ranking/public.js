// Ranking público de uma rodada encerrada.
//
// A página lia /users, /settings e /predictions direto do Firestore sem login.
// Isso já não funcionava (as regras exigem autenticação) e, se funcionasse,
// entregaria a coleção global de usuários a qualquer visitante. Aqui o servidor
// monta o resultado com o Admin SDK e devolve só o que é público: nome,
// cartela e pontos.
import { getAdminDb } from '../_shared/firebaseAdmin.js';
import { DEFAULT_TENANT_ID } from '../_shared/tenant.js';

// Mesma regra de pontuação da tela.
function calcPoints(ph, pa, rh, ra) {
  if (ph === rh && pa === ra) return 10;                    // placar exato
  const rp = ph - pa, rr = rh - ra;
  const mesmoLado = (rp > 0 && rr > 0) || (rp < 0 && rr < 0) || (rp === 0 && rr === 0);
  if (!mesmoLado) return 0;                                 // errou o vencedor
  if (rp === rr) return 7;                                  // acertou o saldo
  if (ph === rh || pa === ra) return 5;                     // acertou um placar
  return 3;                                                 // só o vencedor
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const roundId = String(req.query?.roundId || req.body?.roundId || '').trim();
    if (!roundId) return res.status(400).json({ error: 'Parâmetro: roundId' });

    const db = getAdminDb();

    const roundSnap = await db.collection('rounds').doc(roundId).get();
    if (!roundSnap.exists) return res.status(404).json({ error: 'Rodada não encontrada.' });
    const round = roundSnap.data();

    // Só rodada apurada vira página pública: antes disso o ranking parcial
    // entregaria a posição de quem ainda está jogando.
    if (round.status !== 'finished') {
      return res.status(409).json({ error: 'O resultado desta rodada ainda não foi apurado.' });
    }

    const tenantId = round.tenantId || DEFAULT_TENANT_ID;

    const [settingsSnap, predsSnap, membrosSnap] = await Promise.all([
      db.collection('settings').where('tenantId', '==', tenantId).limit(1).get(),
      db.collection('predictions').where('roundId', '==', roundId).get(),
      db.collection('tenants').doc(tenantId).collection('members').get(),
    ]);

    const settings = settingsSnap.empty ? {} : settingsSnap.docs[0].data();
    const betValue = settings.betValue || 15;
    const brandName = settings.brandName || '';

    // Nomes saem dos membros do bolão — não da coleção global de usuários.
    const nomes = {};
    membrosSnap.docs.forEach(d => { nomes[d.id] = d.data().name || 'Participante'; });

    const cartelas = {};
    predsSnap.docs.forEach(d => {
      const p = d.data();
      if (!p.paid) return;
      if ((p.tenantId || DEFAULT_TENANT_ID) !== tenantId) return; // cartela homônima de outro bolão
      const chave = `${p.userId}__${p.cartelaCode || 'ANTIGA'}`;
      if (!cartelas[chave]) cartelas[chave] = { userId: p.userId, cartelaCode: p.cartelaCode || 'ANTIGA', preds: [] };
      cartelas[chave].preds.push(p);
    });

    const ranking = Object.values(cartelas).map(c => {
      let pts = 0;
      for (const pred of c.preds) {
        const jogo = (round.matches || []).find(m => m.id === pred.matchId);
        if (!jogo || jogo.homeScore == null || jogo.awayScore == null) continue;
        pts += calcPoints(pred.homeScore, pred.awayScore, jogo.homeScore, jogo.awayScore);
      }
      return { name: nomes[c.userId] || 'Participante', cartelaCode: c.cartelaCode, points: pts };
    }).sort((a, b) => b.points - a.points);

    const totalPaid = ranking.length * betValue;
    const prizePool = totalPaid * 0.85;
    const maxPts = ranking[0]?.points ?? 0;
    const winners = ranking.filter(r => r.points === maxPts);

    // Cache curto: a rodada já está encerrada, o conteúdo não muda mais.
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
    return res.status(200).json({
      round: { id: roundId, name: round.name || `Rodada ${round.number}`, number: round.number || null },
      brandName,
      ranking,
      prize: { totalPaid, prizePool, prizePerWinner: winners.length ? prizePool / winners.length : 0, winners },
    });
  } catch (err) {
    console.error('ranking/public:', err.message);
    return res.status(500).json({ error: 'Erro ao montar o ranking' });
  }
}
