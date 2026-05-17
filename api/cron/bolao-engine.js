import { db, getSettings, sendWhatsApp, formatPhone } from '../_shared/firebase.js';
import { collection, getDocs, doc, updateDoc, query, where } from 'firebase/firestore';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const settings = await getSettings();
    const ADMIN_PHONE = formatPhone(settings?.whatsapp?.number || process.env.ADMIN_WHATSAPP_NUMBER || '5511999999999');
    const GROUP_JID = (settings?.whatsapp?.groupJid || '').trim();

    // Envia para o grupo se configurado; caso contrário envia para cada usuário individualmente
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
    const now = new Date();
    const logs = [];

    for (const roundDoc of roundsSnap.docs) {
      const round = roundDoc.data();
      const roundId = roundDoc.id;
      const roundName = round.name || `Rodada ${round.number}`;

      let firstMatchDate = null;
      if (round.matches?.length) {
        const sorted = [...round.matches].sort((a, b) => new Date(a.date) - new Date(b.date));
        firstMatchDate = new Date(sorted[0].date);
      }

      // 1. AUTO-ABERTURA: rodadas 'upcoming' com 1º jogo em ≤ 5 dias → abrir
      if (round.status === 'upcoming' && firstMatchDate) {
        const daysDiff = (firstMatchDate - now) / (1000 * 60 * 60 * 24);
        if (daysDiff <= 5 && daysDiff > 0) {
          await updateDoc(doc(db, 'rounds', roundId), { status: 'open' });
          logs.push(`${roundName} aberta automaticamente (${daysDiff.toFixed(1)} dias para o 1º jogo).`);

          if (!round.notificacaoAberturaEnviada) {
            // Flag marcada ANTES do loop para evitar duplo envio caso a execução
            // ultrapasse 5 min e um segundo cron inicie antes do loop terminar.
            await updateDoc(doc(db, 'rounds', roundId), { notificacaoAberturaEnviada: true });
            const msg = `✅ *Bolão Brasileirão*\nA *${roundName}* foi aberta para palpites! Vocês têm até ${daysDiff.toFixed(0)} dia(s) para apostar. Boa sorte! ⚽`;
            const usersSnap = GROUP_JID ? null : await getDocs(collection(db, 'users'));
            await broadcastMsg(msg, usersSnap);
            logs.push(`Notificação de abertura da ${roundName} enviada ${GROUP_JID ? 'ao grupo' : 'individualmente'}.`);
          }
        }
      }

      // 2. ALERTA 1 HORA: rodadas abertas, 1h antes do fechamento — sempre individual (aviso personalizado)
      if (round.status === 'open' && firstMatchDate) {
        const lockTime = new Date(firstMatchDate.getTime() - 5 * 60 * 1000);
        const hoursDiff = (lockTime - now) / (1000 * 60 * 60);

        if (hoursDiff <= 1 && hoursDiff > 0 && !round.alertaFaltando1hEnviado) {
          // Flag marcada ANTES do loop — garante que um segundo cron concorrente
          // não reenvie a mensagem enquanto este loop ainda está em execução.
          await updateDoc(doc(db, 'rounds', roundId), { alertaFaltando1hEnviado: true });

          if (GROUP_JID) {
            // Para o grupo: um único aviso geral (não sabemos quem já apostou)
            const msg = `⏰ *Atenção, pessoal!*\nA *${roundName}* fecha em 1 hora! Quem ainda não apostou, corre lá! ⚽`;
            await sendWhatsApp(GROUP_JID, msg, settings);
            logs.push(`Alerta de 1h da ${roundName} enviado ao grupo.`);
          } else {
            // Sem grupo: aviso individual apenas para quem ainda não apostou
            const predsSnap = await getDocs(query(collection(db, 'predictions'), where('roundId', '==', roundId)));
            const bettorsIds = new Set(predsSnap.docs.map(d => d.data().userId));
            const usersSnap = await getDocs(collection(db, 'users'));
            let count = 0;
            for (const userDoc of usersSnap.docs) {
              const user = userDoc.data();
              if (!user.isAdmin && user.whatsapp && !bettorsIds.has(userDoc.id)) {
                const msg = `⏰ *Atenção!*\nA *${roundName}* fecha em 1 hora! Acesse o sistema agora e registre seus palpites antes que seja tarde demais!`;
                await sendWhatsApp(formatPhone(user.whatsapp), msg, settings);
                count++;
              }
            }
            logs.push(`Alerta de 1h enviado para ${count} usuários sem palpite na ${roundName}.`);
          }
        }
      }

      // 3. AUTO-FECHAMENTO: 5 minutos antes do 1º jogo
      if (firstMatchDate) {
        const lockTime = new Date(firstMatchDate.getTime() - 5 * 60 * 1000);

        if (round.status === 'open' && lockTime <= now) {
          await updateDoc(doc(db, 'rounds', roundId), { status: 'closed' });
          logs.push(`${roundName} fechada automaticamente (5 min antes do 1º jogo).`);
        }

        // Enviar notificação de fechamento se o horário passou e ainda não foi enviada.
        // Cobre o caso em que o timer do cliente (App.jsx) fechou a rodada antes do cron,
        // pois nesse caso o status já é 'closed' mas a mensagem nunca foi enviada.
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
    }

    // 4. AUTO-FINALIZAÇÃO DE MATCHES: rodadas closed/finished com placar setado,
    //    finished=false, e horário do jogo passado há mais de 115 min.
    const FINISH_AFTER_MS = 115 * 60 * 1000;
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
        if (Date.now() - new Date(match.date).getTime() >= FINISH_AFTER_MS) {
          changed = true;
          return { ...match, finished: true };
        }
        return match;
      });

      if (changed) {
        await updateDoc(doc(db, 'rounds', roundId), { matches: updatedMatches });
        const roundName = round.name || `Rodada ${round.number}`;
        logs.push(`Matches auto-finalizados na ${roundName}.`);
      }
    }

    return res.status(200).json({ success: true, executedAt: now.toISOString(), logs });
  } catch (err) {
    console.error('bolao-engine error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
}
