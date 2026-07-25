import { db, getSettings, sendWhatsApp, sendWhatsAppDocument, formatPhone } from '../_shared/firebase.js';
import { collection, getDocs, doc, updateDoc, query, where, serverTimestamp } from '../_shared/firestore.js';

// ─── Constantes ────────────────────────────────────────────────────────────────
// Tempo mínimo após o horário do jogo para considerá-lo encerrado automaticamente.
// Cobre o pior caso: 90 min regulares + 7 acréscimos + 5 intervalo prorrogação
// + 30 min prorrogação + 5 acréscimos ET + 15 min pênaltis + 18 min margem de segurança.
// Este fallback só é usado quando a API não retorna status (ex: API indisponível).
const FINISH_AFTER_MS = 170 * 60 * 1000; // 170 min (~2h50) — fallback seguro para pênaltis

// Status em andamento (API-Football short codes) — jogo NÃO pode ser marcado como finalizado.
// Sincronizado com api/services/footballApi.js.
const IN_PROGRESS_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'INT', 'LIVE']);

// ─── Helpers ───────────────────────────────────────────────────────────────────

// Verifica se um jogo está efetivamente encerrado (flag manual OU status terminal da API OU fallback por tempo).
function isEffectivelyFinished(match) {
  // Flag manual do admin sempre prevalece
  if (match.finished) return true;
  if (match.homeScore == null || match.awayScore == null) return false;
  if (!match.date) return false;
  // Se a API informou um status em andamento (prorrogação, pênaltis, etc.), aguardar
  if (match.matchStatus && IN_PROGRESS_STATUSES.has(match.matchStatus)) return false;
  // Fallback por tempo: só aplica quando API não forneceu status ou está indisponível
  return Date.now() - new Date(match.date).getTime() >= FINISH_AFTER_MS;
}

// Calcula pontos de um palpite — exato=3pts, tendência=1pt (igual ao App.jsx)
function calcPoints(predHome, predAway, realHome, realAway) {
  if (realHome == null || realAway == null) return 0;
  if (predHome === realHome && predAway === realAway) return 3;
  const pr = predHome > predAway ? 'H' : predHome < predAway ? 'A' : 'D';
  const mr = realHome > realAway ? 'H' : realHome < realAway ? 'A' : 'D';
  return pr === mr ? 1 : 0;
}

// Gera PDF do ranking em base64 para envio via EvolutionAPI (Node.js compatível)
async function generateRankingPdf(roundName, ranking) {
  try {
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    // Cabeçalho verde
    pdf.setFillColor(21, 128, 61);
    pdf.rect(0, 0, 210, 35, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(18);
    pdf.setFont('helvetica', 'bold');
    pdf.text('BOLÃO BRASILEIRÃO 2026', 105, 14, { align: 'center' });
    pdf.setFontSize(13);
    pdf.text(`Resultado — ${roundName}`, 105, 26, { align: 'center' });

    // Banner do vencedor
    if (ranking.length > 0) {
      const winner = ranking[0];
      pdf.setFillColor(250, 204, 21);
      pdf.rect(15, 42, 180, 22, 'F');
      pdf.setTextColor(0, 0, 0);
      pdf.setFontSize(13);
      pdf.setFont('helvetica', 'bold');
      pdf.text(`🏆 CAMPEÃO: ${winner.name}`, 105, 52, { align: 'center' });
      pdf.setFontSize(11);
      pdf.text(`${winner.points} pontos`, 105, 61, { align: 'center' });
    }

    // Cabeçalho da tabela
    pdf.setTextColor(0, 0, 0);
    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'bold');
    pdf.text('#', 20, 76);
    pdf.text('Participante', 35, 76);
    pdf.text('Pts', 175, 76);
    pdf.setDrawColor(200, 200, 200);
    pdf.line(15, 78, 195, 78);

    pdf.setFont('helvetica', 'normal');
    let y = 86;
    ranking.forEach((entry, idx) => {
      if (y > 272) { pdf.addPage(); y = 20; }
      if (idx % 2 === 0) {
        pdf.setFillColor(245, 245, 245);
        pdf.rect(15, y - 5, 180, 9, 'F');
      }
      pdf.setTextColor(120, 120, 120);
      pdf.text(String(idx + 1), 20, y);
      pdf.setTextColor(0, 0, 0);
      // Truncar nome longo
      const name = entry.name.length > 32 ? entry.name.slice(0, 31) + '…' : entry.name;
      pdf.text(name, 35, y);
      pdf.setFont('helvetica', 'bold');
      pdf.text(String(entry.points), 175, y);
      pdf.setFont('helvetica', 'normal');
      y += 9;
    });

    // Rodapé
    pdf.setFontSize(8);
    pdf.setTextColor(150, 150, 150);
    pdf.text(
      `Gerado automaticamente em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
      105, 287, { align: 'center' }
    );

    return Buffer.from(pdf.output('arraybuffer')).toString('base64');
  } catch (err) {
    console.error('[bolao-engine] PDF generation error:', err.message);
    return null;
  }
}

// Calcula o ranking de uma rodada a partir dos palpites pagos no Firestore
// Retorna: [{ userId, name, cartelaCode, points }] ordenado decrescente
async function calcRoundRanking(roundId, roundMatches) {
  const predsSnap = await getDocs(
    query(collection(db, 'predictions'), where('roundId', '==', roundId))
  );
  const usersSnap = await getDocs(collection(db, 'users'));
  const nameMap = {};
  usersSnap.docs.forEach(d => { nameMap[d.id] = d.data().name || 'Participante'; });

  // Agrupar palpites por cartela (userId + cartelaCode)
  const cartelas = {};
  predsSnap.docs.forEach(d => {
    const p = d.data();
    if (!p.paid) return; // só cartelas pagas
    const key = `${p.userId}__${p.cartelaCode || 'ANTIGA'}`;
    if (!cartelas[key]) {
      cartelas[key] = { userId: p.userId, cartelaCode: p.cartelaCode || 'ANTIGA', preds: [] };
    }
    cartelas[key].preds.push(p);
  });

  // Calcular pontos por cartela
  const ranking = Object.values(cartelas).map(c => {
    let pts = 0;
    for (const pred of c.preds) {
      const match = roundMatches.find(m => m.id === pred.matchId);
      if (!match || match.homeScore == null || match.awayScore == null) continue;
      pts += calcPoints(pred.homeScore, pred.awayScore, match.homeScore, match.awayScore);
    }
    return {
      userId: c.userId,
      name: nameMap[c.userId] || 'Participante',
      cartelaCode: c.cartelaCode,
      points: pts
    };
  });

  return ranking.sort((a, b) => b.points - a.points);
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const settings = await getSettings();
    const ADMIN_PHONE = formatPhone(settings?.whatsapp?.number || process.env.ADMIN_WHATSAPP_NUMBER || '5511999999999');
    const GROUP_JID = (settings?.whatsapp?.groupJid || '').trim();

    // Envia para o grupo se configurado; caso contrário envia individualmente para cada usuário
    const broadcastMsg = async (msg, usersSnap) => {
      if (GROUP_JID) {
        await sendWhatsApp(GROUP_JID, msg, settings);
      } else if (usersSnap) {
        for (const userDoc of usersSnap.docs) {
          const user = userDoc.data();
          if (!user.isAdmin && user.whatsapp) {
            await sendWhatsApp(formatPhone(user.whatsapp), msg, settings);
          }
        }
      }
    };

    const roundsSnap = await getDocs(collection(db, 'rounds'));
    const allRounds = roundsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const now = new Date();
    const logs = [];

    // ─── Step 1: AUTO-ABERTURA ─────────────────────────────────────────────────
    // Rodadas 'upcoming' com 1º jogo em ≤ 5 dias → abrir e notificar
    for (const roundDoc of roundsSnap.docs) {
      const round = roundDoc.data();
      const roundId = roundDoc.id;
      const roundName = round.name || `Rodada ${round.number}`;

      if (round.status !== 'upcoming' || !round.matches?.length) continue;

      const sorted = [...round.matches].sort((a, b) => new Date(a.date) - new Date(b.date));
      const firstMatchDate = new Date(sorted[0].date);
      const daysDiff = (firstMatchDate - now) / (1000 * 60 * 60 * 24);

      if (daysDiff > 5 || daysDiff <= 0) continue;

      await updateDoc(doc(db, 'rounds', roundId), { status: 'open' });
      logs.push(`${roundName} aberta automaticamente (${daysDiff.toFixed(1)} dias para o 1º jogo).`);

      if (!round.notificacaoAberturaEnviada) {
        await updateDoc(doc(db, 'rounds', roundId), { notificacaoAberturaEnviada: true });
        const msg = `✅ *Bolão Brasileirão*\nA *${roundName}* foi aberta para palpites! Vocês têm até ${Math.ceil(daysDiff)} dia(s) para apostar. Boa sorte! ⚽`;
        const usersSnap = GROUP_JID ? null : await getDocs(collection(db, 'users'));
        await broadcastMsg(msg, usersSnap);
        logs.push(`Notificação de abertura da ${roundName} enviada ${GROUP_JID ? 'ao grupo' : 'individualmente'}.`);
      }
    }

    // ─── Step 2: ALERTA 1 HORA ────────────────────────────────────────────────
    // Rodadas abertas, 1h antes do fechamento
    for (const roundDoc of roundsSnap.docs) {
      const round = roundDoc.data();
      const roundId = roundDoc.id;
      const roundName = round.name || `Rodada ${round.number}`;

      if (round.status !== 'open' || !round.matches?.length) continue;

      const sorted = [...round.matches].sort((a, b) => new Date(a.date) - new Date(b.date));
      const firstMatchDate = new Date(sorted[0].date);
      const lockTime = new Date(firstMatchDate.getTime() - 5 * 60 * 1000);
      const hoursDiff = (lockTime - now) / (1000 * 60 * 60);

      if (hoursDiff > 1 || hoursDiff <= 0 || round.alertaFaltando1hEnviado) continue;

      await updateDoc(doc(db, 'rounds', roundId), { alertaFaltando1hEnviado: true });

      if (GROUP_JID) {
        await sendWhatsApp(GROUP_JID, `⏰ *Atenção, pessoal!*\nA *${roundName}* fecha em 1 hora! Quem ainda não apostou, corre lá! ⚽`, settings);
        logs.push(`Alerta de 1h da ${roundName} enviado ao grupo.`);
      } else {
        const predsSnap = await getDocs(query(collection(db, 'predictions'), where('roundId', '==', roundId)));
        const bettorsIds = new Set(predsSnap.docs.map(d => d.data().userId));
        const usersSnap = await getDocs(collection(db, 'users'));
        let count = 0;
        for (const userDoc of usersSnap.docs) {
          const user = userDoc.data();
          if (!user.isAdmin && user.whatsapp && !bettorsIds.has(userDoc.id)) {
            await sendWhatsApp(formatPhone(user.whatsapp), `⏰ *Atenção!*\nA *${roundName}* fecha em 1 hora! Acesse o sistema agora e registre seus palpites!`, settings);
            count++;
          }
        }
        logs.push(`Alerta de 1h enviado para ${count} usuários sem palpite na ${roundName}.`);
      }
    }

    // ─── Step 3: AUTO-FECHAMENTO ──────────────────────────────────────────────
    // 5 min antes do 1º jogo → fechar + notificar
    for (const roundDoc of roundsSnap.docs) {
      const round = roundDoc.data();
      const roundId = roundDoc.id;
      const roundName = round.name || `Rodada ${round.number}`;

      if (!round.matches?.length) continue;

      const sorted = [...round.matches].sort((a, b) => new Date(a.date) - new Date(b.date));
      const lockTime = new Date(new Date(sorted[0].date).getTime() - 5 * 60 * 1000);

      if (round.status === 'open' && lockTime <= now) {
        await updateDoc(doc(db, 'rounds', roundId), { status: 'closed' });
        logs.push(`${roundName} fechada automaticamente (5 min antes do 1º jogo).`);
      }

      const jaFechada = round.status === 'open' || round.status === 'closed';
      if (jaFechada && lockTime <= now && !round.notificacaoFechamentoEnviada) {
        await updateDoc(doc(db, 'rounds', roundId), { notificacaoFechamentoEnviada: true });
        const msg = `🔒 *${roundName} fechada!*\nOs palpites estão encerrados. Bora torcer! ⚽🔥`;
        if (GROUP_JID) {
          await sendWhatsApp(GROUP_JID, msg, settings);
          logs.push(`Notificação de fechamento da ${roundName} enviada ao grupo.`);
        } else {
          await sendWhatsApp(ADMIN_PHONE, msg, settings);
          logs.push(`Notificação de fechamento da ${roundName} enviada ao admin.`);
        }
      }
    }

    // ─── Step 4: AUTO-FINALIZAÇÃO DE MATCHES ─────────────────────────────────
    // Matches com placar, finished=false, e data passada há ≥115min → finished=true
    for (const roundDoc of roundsSnap.docs) {
      const round = roundDoc.data();
      const roundId = roundDoc.id;
      if (round.status !== 'closed' && round.status !== 'finished') continue;
      if (!round.matches?.length) continue;

      let changed = false;
      const updatedMatches = round.matches.map(match => {
        if (match.finished) return match;
        if (match.homeScore == null || match.awayScore == null) return match;
        if (!match.date) return match;
        // Se a API sinalizou que o jogo está em andamento (prorrogação, pênaltis, etc.),
        // NÃO finalizar — aguardar sync-scores atualizar com status terminal
        if (match.matchStatus && IN_PROGRESS_STATUSES.has(match.matchStatus)) return match;
        if (Date.now() - new Date(match.date).getTime() >= FINISH_AFTER_MS) {
          changed = true;
          return { ...match, finished: true };
        }
        return match;
      });

      if (changed) {
        await updateDoc(doc(db, 'rounds', roundId), { matches: updatedMatches });
        logs.push(`Matches auto-finalizados na ${round.name || roundDoc.id}.`);
      }
    }

    // ─── Step 5: AUTO-FINALIZAÇÃO DE RODADAS ─────────────────────────────────
    // Rodadas 'closed', não ainda finalizadas, onde TODOS os matches estão encerrados:
    // → calcular ranking → enviar resultado ao grupo (texto + PDF) → status 'finished'
    // Reler o snapshot atualizado para capturar matches recém-marcados no Step 4.
    const roundsSnap2 = await getDocs(collection(db, 'rounds'));

    for (const roundDoc of roundsSnap2.docs) {
      const round = roundDoc.data();
      const roundId = roundDoc.id;

      if (round.status !== 'closed') continue;
      if (round.resultadoCalculado) continue;       // já processado
      if (!round.matches?.length) continue;

      // Verificar se TODOS os jogos estão efetivamente encerrados
      const allDone = round.matches.every(isEffectivelyFinished);
      if (!allDone) continue;

      const roundName = round.name || `Rodada ${round.number}`;
      logs.push(`${roundName}: todos os jogos encerrados — finalizando...`);

      // Idempotency: gravar flag ANTES de qualquer operação pesada
      await updateDoc(doc(db, 'rounds', roundId), { resultadoCalculado: true });

      // Calcular ranking com scoring correto (3pts/1pt, apenas cartelas pagas)
      const ranking = await calcRoundRanking(roundId, round.matches);

      // Buscar próxima rodada (upcoming ou open, número maior)
      const nextRound = allRounds
        .filter(r => (r.status === 'upcoming' || r.status === 'open') && (r.number || 0) > (round.number || 0))
        .sort((a, b) => (a.number || 0) - (b.number || 0))[0];

      // Link para o ranking da app (fallback se PDF falhar)
      const appUrl = (settings?.appUrl || process.env.APP_URL || '').replace(/\/$/, '');
      const rankingLink = appUrl ? `${appUrl}/ranking/${roundId}` : null;

      // Montar mensagem de resultado
      const winner = ranking[0];
      const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
      let resultMsg = `🏆 *BOLÃO BRASILEIRÃO — ${roundName} ENCERRADA!*\n\n`;

      if (winner) {
        resultMsg += `🥇 *Parabéns ao campeão: ${winner.name} _(${winner.cartelaCode})_!*\n`;
        resultMsg += `🎯 ${winner.points} pontos\n\n`;
      }

      if (ranking.length > 0) {
        resultMsg += `📊 *Top 5:*\n`;
        ranking.slice(0, 5).forEach((r, i) => {
          resultMsg += `${medals[i] || `${i + 1}.`} ${r.name} (${r.cartelaCode}) — ${r.points} pts\n`;
        });
      }

      resultMsg += `\n🙏 Obrigado a todos que participaram desta rodada!`;

      if (nextRound) {
        const nextMatches = (nextRound.matches || []).sort((a, b) => new Date(a.date) - new Date(b.date));
        const nextFirst = nextMatches[0];
        const nextDateStr = nextFirst?.date
          ? new Date(nextFirst.date).toLocaleDateString('pt-BR', {
              weekday: 'long', day: '2-digit', month: '2-digit',
              timeZone: 'America/Sao_Paulo'
            })
          : null;
        resultMsg += `\n\n📢 *Próxima: ${nextRound.name}*`;
        if (nextDateStr) resultMsg += ` — começa ${nextDateStr}`;
        resultMsg += `\nFique ligado e faça seus palpites! ⚽`;
      }

      if (rankingLink) resultMsg += `\n\n📋 *Ranking completo:*\n${rankingLink}`;

      // Gerar e enviar PDF; verificar retorno e logar falha sem bloquear
      const target = GROUP_JID || ADMIN_PHONE;
      if (target) {
        const pdfBase64 = await generateRankingPdf(roundName, ranking);
        if (pdfBase64) {
          const pdfOk = await sendWhatsAppDocument(
            target,
            pdfBase64,
            `resultado-${round.number || roundId}.pdf`,
            `📊 Resultado completo — ${roundName}`,
            settings
          );
          if (pdfOk) {
            logs.push(`PDF do resultado da ${roundName} enviado ${GROUP_JID ? 'ao grupo' : 'ao admin'}.`);
          } else {
            logs.push(`[AVISO] PDF da ${roundName} não foi entregue — link incluído na mensagem como fallback.`);
          }
        } else {
          logs.push(`[AVISO] PDF da ${roundName} não pôde ser gerado — link incluído na mensagem.`);
        }
        await sendWhatsApp(target, resultMsg, settings);
        logs.push(`Mensagem de resultado da ${roundName} enviada.`);
      }

      // Marcar rodada como finalizada
      await updateDoc(doc(db, 'rounds', roundId), {
        status: 'finished',
        resultSentToGroup: !!GROUP_JID,
        ranking,
        finishedAt: serverTimestamp()
      });

      logs.push(`${roundName} marcada como finalizada automaticamente.`);
    }

    return res.status(200).json({ success: true, executedAt: now.toISOString(), logs });
  } catch (err) {
    console.error('bolao-engine error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
}
