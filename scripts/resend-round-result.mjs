/**
 * Script de reenvio de resultado — executa a lógica do Step 5 do bolao-engine
 * localmente para uma rodada específica.
 *
 * Uso: node scripts/resend-round-result.mjs <roundId>
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, query, where, serverTimestamp } from 'firebase/firestore';
import axios from 'axios';
import https from 'https';
import { jsPDF } from 'jspdf';

const ROUND_ID = process.argv[2];
if (!ROUND_ID) { console.error('Usage: node scripts/resend-round-result.mjs <roundId>'); process.exit(1); }

const firebaseConfig = {
  apiKey: 'AIzaSyCDEbEF3wQQck2bbIZfW1tCNROJzJ39cXQ',
  authDomain: 'bolao-brasileirao-dev-kd.firebaseapp.com',
  projectId: 'bolao-brasileirao-dev-kd',
  storageBucket: 'bolao-brasileirao-dev-kd.firebasestorage.app',
  messagingSenderId: '1084218540237',
  appId: '1:1084218540237:web:3e9b1d8d194a2e93472984'
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ── Helpers ──────────────────────────────────────────────────────────────────

function calcPoints(ph, pa, rh, ra) {
  if (rh == null || ra == null) return 0;
  if (ph === rh && pa === ra) return 3;
  const pr = ph > pa ? 'H' : ph < pa ? 'A' : 'D';
  const mr = rh > ra ? 'H' : rh < ra ? 'A' : 'D';
  return pr === mr ? 1 : 0;
}

async function sendWhatsApp(number, text, settings) {
  const cfg = settings?.devolution || {};
  const link = cfg.link;
  const instance = cfg.instanceName;
  const token = cfg.token;
  if (!link || !instance || !token) { console.warn('[WA] EvolutionAPI não configurada'); return false; }
  const base = link.trim().replace(/\/$/, '');
  const url = `${base}/message/sendText/${encodeURIComponent(instance.trim())}`;
  const agent = url.startsWith('https') ? new https.Agent({ rejectUnauthorized: false }) : undefined;
  try {
    await axios.post(url, { number, text }, { headers: { 'Content-Type': 'application/json', apikey: token }, httpsAgent: agent, timeout: 15000 });
    return true;
  } catch (err) { console.error('[WA] Erro texto:', err.response?.data || err.message); return false; }
}

async function sendWhatsAppDocument(number, base64Pdf, fileName, caption, settings) {
  const cfg = settings?.devolution || {};
  const link = cfg.link;
  const instance = cfg.instanceName;
  const token = cfg.token;
  if (!link || !instance || !token) { console.warn('[WA] EvolutionAPI não configurada'); return false; }
  const base = link.trim().replace(/\/$/, '');
  const url = `${base}/message/sendMedia/${encodeURIComponent(instance.trim())}`;
  const agent = url.startsWith('https') ? new https.Agent({ rejectUnauthorized: false }) : undefined;
  try {
    await axios.post(url, { number, mediatype: 'document', mimetype: 'application/pdf', caption, media: base64Pdf, fileName }, { headers: { 'Content-Type': 'application/json', apikey: token }, httpsAgent: agent, timeout: 30000 });
    return true;
  } catch (err) { console.error('[WA] Erro PDF:', err.response?.data || err.message); return false; }
}

async function generateRankingPdf(roundName, ranking) {
  try {
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    pdf.setFillColor(21, 128, 61);
    pdf.rect(0, 0, 210, 35, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(18); pdf.setFont('helvetica', 'bold');
    pdf.text('BOLÃO BRASILEIRÃO 2026', 105, 14, { align: 'center' });
    pdf.setFontSize(13);
    pdf.text(`Resultado — ${roundName}`, 105, 26, { align: 'center' });
    if (ranking.length > 0) {
      const w = ranking[0];
      pdf.setFillColor(250, 204, 21);
      pdf.rect(15, 42, 180, 22, 'F');
      pdf.setTextColor(0, 0, 0); pdf.setFontSize(13); pdf.setFont('helvetica', 'bold');
      pdf.text(`🏆 CAMPEÃO: ${w.name}`, 105, 52, { align: 'center' });
      pdf.setFontSize(11); pdf.text(`${w.points} pontos`, 105, 61, { align: 'center' });
    }
    pdf.setTextColor(0, 0, 0); pdf.setFontSize(11); pdf.setFont('helvetica', 'bold');
    pdf.text('#', 20, 76); pdf.text('Participante', 35, 76); pdf.text('Pts', 175, 76);
    pdf.setDrawColor(200, 200, 200); pdf.line(15, 78, 195, 78);
    pdf.setFont('helvetica', 'normal');
    let y = 86;
    ranking.forEach((e, idx) => {
      if (y > 272) { pdf.addPage(); y = 20; }
      if (idx % 2 === 0) { pdf.setFillColor(245, 245, 245); pdf.rect(15, y - 5, 180, 9, 'F'); }
      pdf.setTextColor(120, 120, 120); pdf.text(String(idx + 1), 20, y);
      pdf.setTextColor(0, 0, 0);
      const name = e.name.length > 32 ? e.name.slice(0, 31) + '…' : e.name;
      pdf.text(name, 35, y); pdf.setFont('helvetica', 'bold'); pdf.text(String(e.points), 175, y);
      pdf.setFont('helvetica', 'normal'); y += 9;
    });
    pdf.setFontSize(8); pdf.setTextColor(150, 150, 150);
    pdf.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, 105, 287, { align: 'center' });
    return Buffer.from(pdf.output('arraybuffer')).toString('base64');
  } catch (err) { console.error('PDF error:', err.message); return null; }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔄 Buscando dados da rodada ${ROUND_ID}...`);

  // Ler settings
  const settingsSnap = await getDocs(collection(db, 'settings'));
  const settings = settingsSnap.empty ? {} : settingsSnap.docs[0].data();
  const GROUP_JID = (settings?.whatsapp?.groupJid || '').trim();
  const ADMIN_PHONE = settings?.whatsapp?.number || '';
  const appUrl = (settings?.appUrl || '').replace(/\/$/, '');

  console.log(`  → Grupo JID: ${GROUP_JID || '(não configurado)'}`);
  console.log(`  → App URL: ${appUrl || '(não configurada)'}`);

  // Ler rodada
  const roundsSnap = await getDocs(collection(db, 'rounds'));
  const allRounds = roundsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const round = allRounds.find(r => r.id === ROUND_ID);
  if (!round) { console.error(`❌ Rodada ${ROUND_ID} não encontrada`); process.exit(1); }

  console.log(`  → Rodada: ${round.name} | Status: ${round.status} | resultadoCalculado: ${round.resultadoCalculado}`);

  // Buscar palpites pagos
  const predsSnap = await getDocs(query(collection(db, 'predictions'), where('roundId', '==', ROUND_ID)));
  const usersSnap = await getDocs(collection(db, 'users'));
  const nameMap = {};
  usersSnap.docs.forEach(d => { nameMap[d.id] = d.data().name || 'Participante'; });

  // Agrupar por cartela
  const cartelas = {};
  predsSnap.docs.forEach(d => {
    const p = d.data();
    if (!p.paid) return;
    const key = `${p.userId}__${p.cartelaCode || 'ANTIGA'}`;
    if (!cartelas[key]) cartelas[key] = { userId: p.userId, cartelaCode: p.cartelaCode || 'ANTIGA', preds: [] };
    cartelas[key].preds.push(p);
  });

  // Calcular pontos por cartela
  const ranking = Object.values(cartelas).map(c => {
    let pts = 0;
    for (const pred of c.preds) {
      const match = round.matches?.find(m => m.id === pred.matchId);
      if (!match || match.homeScore == null || match.awayScore == null) continue;
      pts += calcPoints(pred.homeScore, pred.awayScore, match.homeScore, match.awayScore);
    }
    return { userId: c.userId, name: nameMap[c.userId] || 'Participante', cartelaCode: c.cartelaCode, points: pts };
  }).sort((a, b) => b.points - a.points);

  console.log(`\n📊 Ranking calculado (${ranking.length} cartelas pagas):`);
  ranking.slice(0, 5).forEach((r, i) => console.log(`  ${i + 1}. ${r.name} (${r.cartelaCode}) — ${r.points} pts`));

  // Próxima rodada
  const nextRound = allRounds
    .filter(r => (r.status === 'upcoming' || r.status === 'open') && (r.number || 0) > (round.number || 0))
    .sort((a, b) => (a.number || 0) - (b.number || 0))[0];

  // Link do ranking público
  const rankingLink = appUrl ? `${appUrl}/ranking/${ROUND_ID}` : null;

  // Montar mensagem
  const winner = ranking[0];
  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
  let resultMsg = `🏆 *BOLÃO BRASILEIRÃO — ${round.name} ENCERRADA!*\n\n`;
  if (winner) {
    resultMsg += `🥇 *Parabéns ao campeão: ${winner.name} _(${winner.cartelaCode})_!*\n`;
    resultMsg += `🎯 ${winner.points} pontos\n\n`;
  }
  resultMsg += `📊 *Top 5:*\n`;
  ranking.slice(0, 5).forEach((r, i) => {
    resultMsg += `${medals[i] || `${i + 1}.`} ${r.name} (${r.cartelaCode}) — ${r.points} pts\n`;
  });
  resultMsg += `\n🙏 Obrigado a todos que participaram desta rodada!`;
  if (nextRound) {
    const nm = (nextRound.matches || []).sort((a, b) => new Date(a.date) - new Date(b.date))[0];
    const dateStr = nm?.date ? new Date(nm.date).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }) : null;
    resultMsg += `\n\n📢 *Próxima: ${nextRound.name}*`;
    if (dateStr) resultMsg += ` — começa ${dateStr}`;
    resultMsg += `\nFique ligado e faça seus palpites! ⚽`;
  }
  if (rankingLink) resultMsg += `\n\n📋 *Ranking completo:*\n${rankingLink}`;

  const target = GROUP_JID || ADMIN_PHONE;
  if (!target) { console.error('❌ Nenhum destino configurado (GROUP_JID nem ADMIN_PHONE)'); process.exit(1); }

  console.log(`\n📤 Enviando para: ${target}`);

  // Gerar e enviar PDF
  console.log('  → Gerando PDF...');
  const pdfBase64 = await generateRankingPdf(round.name, ranking);
  if (pdfBase64) {
    const pdfOk = await sendWhatsAppDocument(target, pdfBase64, `resultado-rodada-${round.number}.pdf`, `📊 Resultado completo — ${round.name}`, settings);
    console.log(pdfOk ? '  ✅ PDF enviado!' : '  ⚠️  PDF não entregue — link incluso na mensagem');
  } else {
    console.log('  ⚠️  Não foi possível gerar PDF');
  }

  // Enviar mensagem texto
  const msgOk = await sendWhatsApp(target, resultMsg, settings);
  console.log(msgOk ? '  ✅ Mensagem enviada!' : '  ❌ Falha ao enviar mensagem');

  // Marcar rodada como finalizada
  await updateDoc(doc(db, 'rounds', ROUND_ID), {
    status: 'finished',
    resultadoCalculado: true,
    resultSentToGroup: !!GROUP_JID,
    ranking,
    finishedAt: serverTimestamp()
  });
  console.log('\n✅ Rodada marcada como finalizada no Firestore.');
  console.log('\nMensagem enviada:\n─────────────────────────────────────────');
  console.log(resultMsg);
  console.log('─────────────────────────────────────────\n');

  process.exit(0);
}

main().catch(err => { console.error('❌ Erro fatal:', err); process.exit(1); });
