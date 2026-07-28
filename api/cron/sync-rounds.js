import { db } from '../_shared/firebase.js';
import { getRoundFixtures, normalizeName } from '../services/footballApi.js';
import { collection, getDocs, addDoc, updateDoc, doc, serverTimestamp, query, where } from '../_shared/firestore.js';
import { listTenants } from '../_shared/tenant.js';

const TOTAL_ROUNDS = 38;

function findTeamId(teamNormalized, teamsMap) {
  if (teamsMap[teamNormalized]) return teamsMap[teamNormalized];
  // Fallback: busca parcial
  for (const [key, id] of Object.entries(teamsMap)) {
    if (key.includes(teamNormalized) || teamNormalized.includes(key)) return id;
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const forceRound = req.query.round ? parseInt(req.query.round, 10) : null;
  const logs = [];

  try {
    // Carregar times do Firestore para resolver IDs (catálogo global)
    const teamsSnap = await getDocs(collection(db, 'teams'));
    const teamsMap = {}; // normalizedName → id
    teamsSnap.docs.forEach(d => {
      teamsMap[d.data().normalizedName] = d.id;
    });

    // Rodadas existentes agrupadas por tenant: byTenant[tid][numero] = rodada
    const tenants = await listTenants();
    const roundsSnap = await getDocs(collection(db, 'rounds'));
    const byTenant = {};
    roundsSnap.docs.forEach(d => {
      const data = d.data();
      const n = data.apiRoundNumber || data.number;
      if (!n || !data.tenantId) return;
      if (!byTenant[data.tenantId]) byTenant[data.tenantId] = {};
      byTenant[data.tenantId][n] = { id: d.id, ...data };
    });

    const roundsToSync = forceRound ? [forceRound] : Array.from({ length: TOTAL_ROUNDS }, (_, i) => i + 1);
    let created = 0, updated = 0, errors = 0;

    for (const roundNum of roundsToSync) {
      try {
        // Uma única busca na API por rodada; o upsert replica para cada tenant
        const fixtures = await getRoundFixtures(roundNum);
        if (!fixtures.length) continue;

        const matches = fixtures.map((f, idx) => {
          const homeTeamId = findTeamId(f.homeTeamNormalized, teamsMap);
          const awayTeamId = findTeamId(f.awayTeamNormalized, teamsMap);
          return {
            id: idx + 1,
            apiEventId: f.apiEventId,
            homeTeamId: homeTeamId || null,
            homeTeamName: f.homeTeamName,
            homeTeamApiId: f.homeTeamApiId,
            homeTeamLogo: f.homeTeamLogo,
            awayTeamId: awayTeamId || null,
            awayTeamName: f.awayTeamName,
            awayTeamApiId: f.awayTeamApiId,
            awayTeamLogo: f.awayTeamLogo,
            date: f.date,
            homeScore: f.homeScore,
            awayScore: f.awayScore,
            finished: f.finished
          };
        });

        // Ordenar matches por data para determinar o 1º jogo (usado no closeAt)
        const sorted = [...matches].sort((a, b) => new Date(a.date) - new Date(b.date));
        const firstMatchDate = sorted[0]?.date;
        // Fechar 5 minutos antes do 1º jogo
        const closeAt = firstMatchDate
          ? new Date(new Date(firstMatchDate).getTime() - 5 * 60 * 1000).toISOString()
          : null;

        // Determina status correto com base nas datas reais dos jogos
        const smartStatus = (() => {
          if (!firstMatchDate) return 'upcoming';
          const first = new Date(firstMatchDate);
          const now = new Date();
          const hoursToFirst = (first - now) / (1000 * 60 * 60);
          if (hoursToFirst < 0) return 'closed';        // 1º jogo já ocorreu
          if (hoursToFirst <= 5 * 24) return 'open';    // dentro de 5 dias → aberta
          return 'upcoming';
        })();

        for (const tenant of tenants) {
          const existing = byTenant[tenant.id]?.[roundNum];
          // Rodada já encerrada e que o tenant nunca teve: não criar. Um bolão
          // novo começa na rodada atual — rodadas passadas viram fantasmas
          // ("em andamento" eterno quando a API não tem placar de jogo adiado)
          // e histórico vazio sem palpites.
          if (!existing && smartStatus === 'closed') continue;
          if (existing) {
            // Atualiza apenas se a rodada ainda não foi finalizada
            if (['upcoming', 'open'].includes(existing.status)) {
              // Aplica smartStatus se a rodada está 'upcoming' mas deveria estar 'open' ou 'closed'
              const statusUpdate = existing.status === 'upcoming' && smartStatus !== 'upcoming'
                ? { status: smartStatus, notificacaoAberturaEnviada: smartStatus !== 'upcoming', alertaFaltando1hEnviado: smartStatus === 'closed' }
                : {};
              await updateDoc(doc(db, 'rounds', existing.id), {
                matches,
                closeAt,
                autoSyncedAt: serverTimestamp(),
                ...statusUpdate
              });
              updated++;
              logs.push(`[${tenant.id}] Rodada ${roundNum} atualizada`);
            }
          } else {
            await addDoc(collection(db, 'rounds'), {
              tenantId: tenant.id,
              number: roundNum,
              apiRoundNumber: roundNum,
              name: `Rodada ${roundNum}`,
              status: smartStatus,
              matches,
              closeAt,
              notificacaoAberturaEnviada: smartStatus !== 'upcoming',
              alertaFaltando1hEnviado: smartStatus === 'closed',
              notificacaoFechamentoEnviada: smartStatus === 'closed',
              resultadoCalculado: false,
              resultSentToGroup: false,
              autoSyncedAt: serverTimestamp(),
              createdAt: serverTimestamp()
            });
            created++;
            logs.push(`[${tenant.id}] Rodada ${roundNum} criada com status "${smartStatus}" (${matches.length} jogos)`);
          }
        }

        // Pausa para respeitar rate limit do TheSportsDB
        await new Promise(r => setTimeout(r, 800));
      } catch (err) {
        errors++;
        logs.push(`Erro na rodada ${roundNum}: ${err.message}`);
      }
    }

    logs.push(`Resumo: Tenants=${tenants.length} | Criadas=${created} | Atualizadas=${updated} | Erros=${errors}`);
    return res.status(200).json({ success: true, logs });
  } catch (err) {
    console.error('sync-rounds error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
}
