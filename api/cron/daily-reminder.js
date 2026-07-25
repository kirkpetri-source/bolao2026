import { db, getSettings, sendWhatsApp, formatPhone } from '../_shared/firebase.js';
import { collection, getDocs, query, where, doc, updateDoc } from '../_shared/firestore.js';

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
    const GROUP_JID = (settings?.whatsapp?.groupJid || '').trim();
    const appUrl = (settings?.appUrl || process.env.APP_URL || '').replace(/\/$/, '');
    const todayBRT = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const logs = [];

    // Buscar rodadas abertas
    const roundsSnap = await getDocs(collection(db, 'rounds'));
    const openRounds = roundsSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(r => r.status === 'open');

    if (openRounds.length === 0) {
      return res.status(200).json({ success: true, message: 'Nenhuma rodada aberta. Nenhum lembrete enviado.', logs });
    }

    const usersSnap = await getDocs(collection(db, 'users'));
    const activeUsers = usersSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(u => !u.isAdmin && u.whatsapp);

    for (const round of openRounds) {
      const roundName = round.name || `Rodada ${round.number}`;

      // Impede envio duplicado no mesmo dia
      if (round.lembreteEnviadoData === todayBRT) {
        logs.push(`Lembrete de ${roundName} já enviado hoje (${todayBRT}). Pulando.`);
        continue;
      }

      // Buscar quais usuários já fizeram palpites nesta rodada
      const predsSnap = await getDocs(
        query(collection(db, 'predictions'), where('roundId', '==', round.id))
      );
      const bettorIds = new Set(predsSnap.docs.map(d => d.data().userId));

      // Usuários que ainda não apostaram
      const pendingUsers = activeUsers.filter(u => !bettorIds.has(u.id));

      if (pendingUsers.length === 0 && !GROUP_JID) {
        logs.push(`Todos os participantes já apostaram na ${roundName}.`);
        continue;
      }

      const roundLink = appUrl ? `\n\n🔗 Acesse agora: ${appUrl}` : '';

      // Mensagem para o grupo
      if (GROUP_JID) {
        const groupMsg = `⚽ *Bolão Brasileirão — Lembrete Diário!*\n\nA *${roundName}* está aberta para palpites!\n\n${pendingUsers.length > 0 ? `⏳ ${pendingUsers.length} participante(s) ainda não apostaram.` : '👏 Todos já apostaram! Boa sorte!'}\n\nCorra e faça seus palpites antes que a rodada feche! 🏃${roundLink}`;
        await sendWhatsApp(GROUP_JID, groupMsg, settings);
        logs.push(`Lembrete enviado ao grupo para ${roundName}.`);
      }

      // Mensagens individuais para quem ainda não apostou
      let individualCount = 0;
      for (const user of pendingUsers) {
        const phone = formatPhone(user.whatsapp);
        if (!phone) continue;
        const msg = `⚽ *Olá, ${user.name || 'participante'}!*\n\nA *${roundName}* do Bolão Brasileirão está aberta e você ainda não fez seus palpites!\n\nNão perca o prazo — acesse agora e aposte antes que a rodada feche! 🤞${roundLink}`;
        const sent = await sendWhatsApp(phone, msg, settings);
        if (sent) individualCount++;
      }

      if (individualCount > 0) {
        logs.push(`Lembrete individual enviado para ${individualCount} participante(s) sem palpite na ${roundName}.`);
      }

      // Marcar data do lembrete no documento da rodada
      await updateDoc(doc(db, 'rounds', round.id), { lembreteEnviadoData: todayBRT });
    }

    return res.status(200).json({ success: true, executedAt: new Date().toISOString(), logs });
  } catch (err) {
    console.error('daily-reminder error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
}
