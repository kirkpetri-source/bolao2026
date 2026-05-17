import { db, getSettings, sendWhatsApp, sendWhatsAppDocument } from '../_shared/firebase.js';
import { getRoundFixtures, getLiveScores } from '../services/footballApi.js';
import {
  collection, getDocs, doc, updateDoc, query, where, serverTimestamp
} from 'firebase/firestore';

// Calcula pontos de um palpite com base no resultado real
function calcPoints(predHome, predAway, realHome, realAway) {
  if (realHome === null || realAway === null) return 0;
  if (predHome === realHome && predAway === realAway) return 10; // Acerto exato
  const predResult = predHome > predAway ? 'H' : predHome < predAway ? 'A' : 'D';
  const realResult = realHome > realAway ? 'H' : realHome < realAway ? 'A' : 'D';
  return predResult === realResult ? 3 : 0; // Acerto de tendência
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

async function finalizeRound(roundId, roundData, settings) {
  const adminPhone = (settings?.whatsapp?.number || process.env.ADMIN_WHATSAPP_NUMBER || '');
  const groupJid = settings?.whatsapp?.groupJid || '';
  const roundName = roundData.name || `Rodada ${roundData.number}`;

  // Buscar todos os palpites da rodada
  const predsSnap = await getDocs(query(collection(db, 'predictions'), where('roundId', '==', roundId)));
  if (predsSnap.empty) {
    await updateDoc(doc(db, 'rounds', roundId), { status: 'finished', resultadoCalculado: true, resultSentToGroup: true });
    return;
  }

  // Buscar nomes dos usuários
  const usersSnap = await getDocs(collection(db, 'users'));
  const userNames = {};
  usersSnap.docs.forEach(d => { userNames[d.id] = d.data().name || 'Participante'; });

  // Calcular pontos de cada palpite e acumular por usuário
  const userPoints = {};
  for (const predDoc of predsSnap.docs) {
    const pred = predDoc.data();
    let totalPoints = 0;

    if (Array.isArray(pred.predictions)) {
      for (const p of pred.predictions) {
        const match = roundData.matches?.find(m => m.id === p.matchId || m.apiEventId === p.apiEventId);
        if (match?.finished) {
          totalPoints += calcPoints(p.homeScore, p.awayScore, match.homeScore, match.awayScore);
        }
      }
    } else if (pred.matchId !== undefined) {
      const match = roundData.matches?.find(m => m.id === pred.matchId);
      if (match?.finished) {
        totalPoints = calcPoints(pred.homeScore, pred.awayScore, match.homeScore, match.awayScore);
      }
    }

    await updateDoc(predDoc.ref, { points: totalPoints });

    const uid = pred.userId;
    if (!userPoints[uid]) userPoints[uid] = { name: userNames[uid] || 'Participante', points: 0 };
    userPoints[uid].points += totalPoints;
  }

  // Montar ranking ordenado
  const ranking = Object.entries(userPoints)
    .map(([uid, data]) => ({ userId: uid, name: data.name, points: data.points }))
    .sort((a, b) => b.points - a.points);

  // ─── Enviar resultado ANTES de marcar como finished ───────────────────────
  // Se o envio falhar, a rodada permanece 'closed' e o cron tenta novamente.
  // Só gravamos 'finished' após confirmação de envio bem-sucedido.
  if (groupJid) {
    const pdfBase64 = await generateRankingPdf(roundName, ranking);
    const winner = ranking[0];
    const winnerMsg = winner
      ? `🏆 *${roundName} — RESULTADO FINAL!*\n\nO campeão desta rodada é *${winner.name}* com *${winner.points} pontos*! Parabéns! 🎉\n\nResultado completo no PDF anexo.`
      : `📊 *${roundName} — RESULTADO FINAL!*\nVeja o ranking completo em anexo.`;

    if (pdfBase64) {
      await sendWhatsAppDocument(groupJid, pdfBase64, `resultado-${roundData.number}.pdf`, winnerMsg, settings);
    }
    await sendWhatsApp(groupJid, winnerMsg, settings);
  } else if (adminPhone) {
    const lines = ranking.slice(0, 10).map((e, i) => `${i + 1}. ${e.name}: ${e.points} pts`).join('\n');
    const msg = `🏆 *${roundName} — Resultado Final*\n\n${lines}`;
    await sendWhatsApp(adminPhone, msg, settings);
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
  if (!dryRun && cronSecret && req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const logs = [];
  const dryRunReport = [];

  try {
    const settings = await getSettings();
    const apiFootballKey = settings?.footballApi?.key || process.env.APIFOOTBALL_KEY;

    // Buscar rodadas fechadas com jogos não finalizados
    const roundsSnap = await getDocs(collection(db, 'rounds'));
    const activeRounds = roundsSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(r => r.status === 'closed' && r.matches?.some(m => !m.finished));

    if (!activeRounds.length) {
      return res.status(200).json({ success: true, dryRun, logs: ['Nenhuma rodada ativa com jogos pendentes.'] });
    }

    // Tentar buscar live scores via API-Football primeiro
    const liveScores = await getLiveScores(apiFootballKey);
    const liveMap = {};
    liveScores.forEach(s => { liveMap[s.apiEventId] = s; });

    for (const round of activeRounds) {
      const roundNum = round.apiRoundNumber || round.number;
      const roundName = round.name || `Rodada ${roundNum}`;
      let updatedMatches = [...round.matches];
      let scoresChanged = false;

      // Buscar scores atuais do TheSportsDB para esta rodada
      let apiFixtures = [];
      try {
        apiFixtures = await getRoundFixtures(roundNum);
      } catch (err) {
        logs.push(`Erro ao buscar rodada ${roundNum} da API: ${err.message}`);
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

        if (homeScore !== match.homeScore || awayScore !== match.awayScore || finished !== match.finished) {
          scoresChanged = true;
        }

        return { ...match, homeScore, awayScore, finished };
      });

      if (dryRun) {
        // Modo simulação: reportar o que seria feito, sem gravar
        const matchReport = updatedMatches.map(m => ({
          home: m.homeTeamName,
          away: m.awayTeamName,
          score: m.homeScore !== null ? `${m.homeScore}x${m.awayScore}` : 'pendente',
          finished: m.finished,
          source: liveMap[m.apiEventId] ? 'api-football-live' : apiMap[m.apiEventId] ? 'thesportsdb' : 'sem-fonte'
        }));
        logs.push(`[DRY RUN] Rodada ${roundNum}: placares ${scoresChanged ? 'teriam sido atualizados' : 'sem alteração'}`);

        const allDone = updatedMatches.every(m => m.finished);
        if (allDone && !round.resultadoCalculado) {
          // Simular cálculo de pontos para o relatório
          const predsSnap = await getDocs(query(collection(db, 'predictions'), where('roundId', '==', round.id)));
          const usersSnap = await getDocs(collection(db, 'users'));
          const userNames = {};
          usersSnap.docs.forEach(d => { userNames[d.id] = d.data().name || 'Participante'; });

          const userPoints = {};
          for (const predDoc of predsSnap.docs) {
            const pred = predDoc.data();
            let totalPoints = 0;
            if (Array.isArray(pred.predictions)) {
              for (const p of pred.predictions) {
                const match = updatedMatches.find(m => m.id === p.matchId || m.apiEventId === p.apiEventId);
                if (match?.finished) totalPoints += calcPoints(p.homeScore, p.awayScore, match.homeScore, match.awayScore);
              }
            } else if (pred.matchId !== undefined) {
              const match = updatedMatches.find(m => m.id === pred.matchId);
              if (match?.finished) totalPoints = calcPoints(pred.homeScore, pred.awayScore, match.homeScore, match.awayScore);
            }
            const uid = pred.userId;
            if (!userPoints[uid]) userPoints[uid] = { name: userNames[uid] || 'Participante', points: 0 };
            userPoints[uid].points += totalPoints;
          }

          const ranking = Object.entries(userPoints)
            .map(([uid, data]) => ({ userId: uid, name: data.name, points: data.points }))
            .sort((a, b) => b.points - a.points);

          const groupJid = settings?.whatsapp?.groupJid || '';
          logs.push(`[DRY RUN] Rodada ${roundNum}: FINALIZARIA agora`);
          dryRunReport.push({
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
            round: roundName,
            roundId: round.id,
            allMatchesFinished: updatedMatches.every(m => m.finished),
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
        logs.push(`Rodada ${roundNum}: placares atualizados`);
      }

      const allDone = updatedMatches.every(m => m.finished);
      if (allDone && !round.resultadoCalculado) {
        logs.push(`Rodada ${roundNum}: todos os jogos terminaram — finalizando...`);
        await finalizeRound(round.id, { ...round, matches: updatedMatches }, settings);
        logs.push(`Rodada ${roundNum}: finalizada, PDF enviado ao grupo.`);
      }
    }

    return res.status(200).json({ success: true, dryRun, logs, ...(dryRun ? { report: dryRunReport } : {}) });
  } catch (err) {
    console.error('sync-scores error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
}
