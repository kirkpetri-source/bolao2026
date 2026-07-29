import { db, getSettings, sendWhatsApp, sendWhatsAppDocument } from '../_shared/firebase.js';
import { getRoundFixtures, getLiveScores, IN_PROGRESS_STATUSES } from '../services/footballApi.js';
import {
  collection, getDocs, doc, updateDoc, query, where, serverTimestamp
} from '../_shared/firestore.js';
import { listTenants, getUsersById } from '../_shared/tenant.js';
import { isMatchPostponed, matchCountsForScoring } from '../_shared/matchStatus.js';

// Calcula pontos de um palpite — exato=3pts, tendência=1pt (igual ao App.jsx)
function calcPoints(predHome, predAway, realHome, realAway) {
  if (realHome == null || realAway == null) return 0;
  if (predHome === realHome && predAway === realAway) return 3;
  const predResult = predHome > predAway ? 'H' : predHome < predAway ? 'A' : 'D';
  const realResult = realHome > realAway ? 'H' : realHome < realAway ? 'A' : 'D';
  return predResult === realResult ? 1 : 0;
}

async function generateRankingPdf(roundName, ranking) {
  try {
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    // Cabeçalho
    pdf.setFillColor(21, 128, 61);
    pdf.rect(0, 0, 210, 35, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(20);
    pdf.setFont('helvetica', 'bold');
    pdf.text('BOLÃO BRASILEIRÃO 2026', 105, 15, { align: 'center' });
    pdf.setFontSize(14);
    pdf.text(`Resultado — ${roundName}`, 105, 27, { align: 'center' });

    // Ganhador em destaque
    if (ranking.length > 0) {
      const winner = ranking[0];
      pdf.setFillColor(250, 204, 21);
      pdf.rect(15, 42, 180, 22, 'F');
      pdf.setTextColor(0, 0, 0);
      pdf.setFontSize(13);
      pdf.setFont('helvetica', 'bold');
      pdf.text(`🏆 GANHADOR: ${winner.name}`, 105, 52, { align: 'center' });
      pdf.setFontSize(11);
      pdf.text(`${winner.points} pontos`, 105, 61, { align: 'center' });
    }

    // Tabela de ranking
    pdf.setTextColor(0, 0, 0);
    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'bold');
    pdf.text('#', 20, 76);
    pdf.text('Participante', 35, 76);
    pdf.text('Pontos', 165, 76);
    pdf.setDrawColor(200, 200, 200);
    pdf.line(15, 78, 195, 78);

    pdf.setFont('helvetica', 'normal');
    let y = 85;
    ranking.forEach((entry, idx) => {
      if (y > 270) { pdf.addPage(); y = 20; }
      if (idx % 2 === 0) {
        pdf.setFillColor(245, 245, 245);
        pdf.rect(15, y - 5, 180, 9, 'F');
      }
      pdf.setTextColor(100, 100, 100);
      pdf.text(String(idx + 1), 20, y);
      pdf.setTextColor(0, 0, 0);
      pdf.text(entry.name, 35, y);
      pdf.setFont('helvetica', 'bold');
      pdf.text(String(entry.points), 165, y);
      pdf.setFont('helvetica', 'normal');
      y += 9;
    });

    // Rodapé
    pdf.setFontSize(8);
    pdf.setTextColor(150, 150, 150);
    pdf.text(`Gerado automaticamente em ${new Date().toLocaleString('pt-BR')}`, 105, 287, { align: 'center' });

    return Buffer.from(pdf.output('arraybuffer')).toString('base64');
  } catch (err) {
    console.error('PDF generation error:', err.message);
    return null;
  }
}

async function finalizeRound(roundId, roundData, settings, userNames) {
  const adminPhone = (settings?.whatsapp?.number || '');
  const groupJid = settings?.whatsapp?.groupJid || '';
  const roundName = roundData.name || `Rodada ${roundData.number}`;

  // Buscar todos os palpites da rodada
  const predsSnap = await getDocs(query(collection(db, 'predictions'), where('roundId', '==', roundId)));
  if (predsSnap.empty) {
    await updateDoc(doc(db, 'rounds', roundId), { status: 'finished', resultadoCalculado: true, resultSentToGroup: true });
    return;
  }

  // Agrupar palpites por cartela (userId + cartelaCode) — nunca acumular entre cartelas
  const cartelaPoints = {};
  for (const predDoc of predsSnap.docs) {
    const pred = predDoc.data();
    if (!pred.paid) continue; // só cartelas pagas

    const uid = pred.userId;
    const code = pred.cartelaCode || 'ANTIGA';
    const key = `${uid}__${code}`;
    let predPts = 0;

    if (Array.isArray(pred.predictions)) {
      for (const p of pred.predictions) {
        const match = roundData.matches?.find(m => m.id === p.matchId || m.apiEventId === p.apiEventId);
        if (matchCountsForScoring(match)) predPts += calcPoints(p.homeScore, p.awayScore, match.homeScore, match.awayScore);
      }
    } else if (pred.matchId !== undefined) {
      const match = roundData.matches?.find(m => m.id === pred.matchId);
      if (matchCountsForScoring(match)) predPts = calcPoints(pred.homeScore, pred.awayScore, match.homeScore, match.awayScore);
    }

    await updateDoc(predDoc.ref, { points: predPts });

    if (!cartelaPoints[key]) {
      cartelaPoints[key] = { userId: uid, cartelaCode: code, name: userNames[uid] || 'Participante', points: 0 };
    }
    cartelaPoints[key].points += predPts;
  }

  // Ranking: uma entrada por cartela — mesmo jogador aparece N vezes se tiver N cartelas
  const ranking = Object.values(cartelaPoints)
    .sort((a, b) => b.points - a.points);

  const appUrl = (settings?.appUrl || process.env.APP_URL || '').replace(/\/$/, '');
  const rankingLink = appUrl ? `${appUrl}/ranking/${roundId}` : null;

  const target = groupJid || adminPhone;
  if (target) {
    const winner = ranking[0];
    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
    let msg = `🏆 *${(settings?.brandName || 'BOLÃO BRASILEIRÃO').toUpperCase()} — ${roundName} ENCERRADA!*\n\n`;
    if (winner) {
      msg += `🥇 *Parabéns ao campeão: ${winner.name} _(${winner.cartelaCode})_!*\n`;
      msg += `🎯 ${winner.points} pontos\n\n`;
    }
    msg += `📊 *Top 5:*\n`;
    ranking.slice(0, 5).forEach((r, i) => {
      msg += `${medals[i] || `${i + 1}.`} ${r.name} (${r.cartelaCode}) — ${r.points} pts\n`;
    });
    msg += `\n🙏 Obrigado a todos que participaram!`;
    if (rankingLink) msg += `\n\n📋 *Ranking completo:*\n${rankingLink}`;

    // Tentar enviar PDF; logar falha mas não bloquear
    if (groupJid) {
      const pdfBase64 = await generateRankingPdf(roundName, ranking);
      if (pdfBase64) {
        const pdfOk = await sendWhatsAppDocument(groupJid, pdfBase64, `resultado-${roundData.number}.pdf`, `📊 Resultado — ${roundName}`, settings);
        if (!pdfOk) console.warn(`[sync-scores] PDF não enviado para o grupo (${roundName}). Link na mensagem como fallback.`);
      }
    }
    await sendWhatsApp(target, msg, settings);
  }

  // Marcar rodada como finalizada apenas após o envio ter sido concluído
  await updateDoc(doc(db, 'rounds', roundId), {
    status: 'finished',
    resultadoCalculado: true,
    resultSentToGroup: true,
    ranking,
    finishedAt: serverTimestamp()
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // ?dryRun=true — executa toda a lógica mas NÃO grava no Firestore NEM envia WhatsApp.
  // Modo leitura pura: liberado sem CRON_SECRET pois não altera nenhum dado.
  const dryRun = req.query.dryRun === 'true';

  const cronSecret = process.env.CRON_SECRET;
  if (!dryRun && (!cronSecret || req.headers['authorization'] !== `Bearer ${cronSecret}`)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const logs = [];
  const dryRunReport = [];

  try {
    // Chave da API de futebol é de plataforma: settings do tenant padrão ou env.
    const platformSettings = await getSettings();
    const apiFootballKey = platformSettings?.footballApi?.key || process.env.APIFOOTBALL_KEY;

    const tenants = await listTenants();
    const usersById = await getUsersById();
    const userNames = {};
    Object.values(usersById).forEach(u => { userNames[u.id] = u.name || 'Participante'; });

    // Rodadas fechadas pendentes de processamento, agrupadas por tenant
    const roundsSnap = await getDocs(collection(db, 'rounds'));
    const activeByTenant = {};
    roundsSnap.docs.forEach(d => {
      const r = { id: d.id, ...d.data() };
      if (r.status !== 'closed' || r.resultadoCalculado || !r.matches?.length || !r.tenantId) return;
      (activeByTenant[r.tenantId] = activeByTenant[r.tenantId] || []).push(r);
    });

    if (!Object.keys(activeByTenant).length) {
      return res.status(200).json({ success: true, dryRun, logs: ['Nenhuma rodada ativa com jogos pendentes.'] });
    }

    // Tentar buscar live scores via API-Football primeiro (uma vez para todos os tenants)
    const liveScores = await getLiveScores(apiFootballKey);
    const liveMap = {};
    liveScores.forEach(s => { liveMap[s.apiEventId] = s; });

    // Cache de fixtures por rodada: vários tenants compartilham as mesmas rodadas do campeonato
    const fixturesCache = {};
    const getFixturesCached = async (roundNum) => {
      if (!(roundNum in fixturesCache)) {
        fixturesCache[roundNum] = await getRoundFixtures(roundNum);
      }
      return fixturesCache[roundNum];
    };

    for (const tenant of tenants) {
      const activeRounds = activeByTenant[tenant.id] || [];
      if (!activeRounds.length) continue;

      const settings = await getSettings(tenant.id);

      for (const round of activeRounds) {
        const roundNum = round.apiRoundNumber || round.number;
        const roundName = round.name || `Rodada ${roundNum}`;
        let updatedMatches = [...round.matches];
        let scoresChanged = false;

        // Buscar scores atuais do TheSportsDB para esta rodada
        let apiFixtures = [];
        try {
          apiFixtures = await getFixturesCached(roundNum);
        } catch (err) {
          logs.push(`[${tenant.id}] Erro ao buscar rodada ${roundNum} da API: ${err.message}`);
          continue;
        }

        const apiMap = {};
        apiFixtures.forEach(f => { apiMap[f.apiEventId] = f; });

        updatedMatches = updatedMatches.map(match => {
          const live = liveMap[match.apiEventId];
          const api = apiMap[match.apiEventId];
          const source = live || api;

          if (!source) return match;

          const homeScore = source.homeScore !== undefined ? source.homeScore : match.homeScore;
          const awayScore = source.awayScore !== undefined ? source.awayScore : match.awayScore;
          const finished = source.finished ?? match.finished;
          // Propaga matchStatus para que bolao-engine possa detectar jogos ainda em andamento
          // (ex: 'ET' = prorrogação, 'P' = pênaltis, 'BT' = intervalo prorrogação)
          const matchStatus = source.matchStatus ?? match.matchStatus ?? null;

          if (
            homeScore !== match.homeScore ||
            awayScore !== match.awayScore ||
            finished !== match.finished ||
            matchStatus !== (match.matchStatus ?? null)
          ) {
            scoresChanged = true;
          }

          return {
            ...match,
            homeScore,
            awayScore,
            finished,
            ...(matchStatus !== null ? { matchStatus } : {})
          };
        });

        if (dryRun) {
          // Modo simulação: reportar o que seria feito, sem gravar
          const matchReport = updatedMatches.map(m => ({
            home: m.homeTeamName,
            away: m.awayTeamName,
            score: m.homeScore !== null ? `${m.homeScore}x${m.awayScore}` : 'pendente',
            finished: m.finished,
            matchStatus: m.matchStatus ?? null,
            inProgress: m.matchStatus ? IN_PROGRESS_STATUSES.has(m.matchStatus) : false,
            source: liveMap[m.apiEventId] ? 'api-football-live' : apiMap[m.apiEventId] ? 'thesportsdb' : 'sem-fonte'
          }));
          logs.push(`[DRY RUN] [${tenant.id}] Rodada ${roundNum}: placares ${scoresChanged ? 'teriam sido atualizados' : 'sem alteração'}`);

          // Adiado conta como resolvido: esperar placar dele travava a rodada.
        const allDone = updatedMatches.every(m => m.finished || isMatchPostponed(m));
          if (allDone && !round.resultadoCalculado) {
            // Simular cálculo de pontos para o relatório
            const predsSnap = await getDocs(query(collection(db, 'predictions'), where('roundId', '==', round.id)));

            const userPoints = {};
            for (const predDoc of predsSnap.docs) {
              const pred = predDoc.data();
              let totalPoints = 0;
              if (Array.isArray(pred.predictions)) {
                for (const p of pred.predictions) {
                  const match = updatedMatches.find(m => m.id === p.matchId || m.apiEventId === p.apiEventId);
                  if (matchCountsForScoring(match)) totalPoints += calcPoints(p.homeScore, p.awayScore, match.homeScore, match.awayScore);
                }
              } else if (pred.matchId !== undefined) {
                const match = updatedMatches.find(m => m.id === pred.matchId);
                if (matchCountsForScoring(match)) totalPoints = calcPoints(pred.homeScore, pred.awayScore, match.homeScore, match.awayScore);
              }
              const uid = pred.userId;
              if (!userPoints[uid]) userPoints[uid] = { name: userNames[uid] || 'Participante', points: 0 };
              userPoints[uid].points += totalPoints;
            }

            const ranking = Object.entries(userPoints)
              .map(([uid, data]) => ({ userId: uid, name: data.name, points: data.points }))
              .sort((a, b) => b.points - a.points);

            const groupJid = settings?.whatsapp?.groupJid || '';
            logs.push(`[DRY RUN] [${tenant.id}] Rodada ${roundNum}: FINALIZARIA agora`);
            dryRunReport.push({
              tenant: tenant.id,
              round: roundName,
              roundId: round.id,
              allMatchesFinished: true,
              scoresChanged,
              matches: matchReport,
              ranking,
              wouldSendTo: groupJid ? `grupo: ${groupJid}` : `admin: ${settings?.whatsapp?.number || '(não configurado)'}`,
              wouldSendPdf: !!groupJid,
              action: 'FINALIZARIA: status→finished, ranking gravado, PDF enviado ao grupo'
            });
          } else {
            dryRunReport.push({
              tenant: tenant.id,
              round: roundName,
              roundId: round.id,
              allMatchesFinished: updatedMatches.every(m => m.finished || isMatchPostponed(m)),
              scoresChanged,
              matches: matchReport,
              action: allDone && round.resultadoCalculado
                ? 'já finalizada (resultadoCalculado=true)'
                : 'aguardando jogos pendentes'
            });
          }
          continue;
        }

        // Modo real: gravar e enviar normalmente
        if (scoresChanged) {
          await updateDoc(doc(db, 'rounds', round.id), {
            matches: updatedMatches,
            liveScoreUpdatedAt: serverTimestamp()
          });
          logs.push(`[${tenant.id}] Rodada ${roundNum}: placares atualizados`);
        }

        // Adiado conta como resolvido: esperar placar dele travava a rodada.
        const allDone = updatedMatches.every(m => m.finished || isMatchPostponed(m));
        if (allDone && !round.resultadoCalculado) {
          logs.push(`[${tenant.id}] Rodada ${roundNum}: todos os jogos terminaram — finalizando...`);
          await finalizeRound(round.id, { ...round, matches: updatedMatches }, settings, userNames);
          logs.push(`[${tenant.id}] Rodada ${roundNum}: finalizada.`);
        }
      }
    }

    return res.status(200).json({ success: true, dryRun, logs, ...(dryRun ? { report: dryRunReport } : {}) });
  } catch (err) {
    console.error('sync-scores error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
}
