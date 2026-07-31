// Monta um bolão de DEMONSTRAÇÃO, com participantes, cartelas, pagamentos e uma
// rodada apurada — para tirar prints do sistema com as telas cheias, sem expor
// dado de cliente real e sem sujar bolão de ninguém.
//
//   node scripts/seed-demo.mjs            → só mostra o que faria
//   node scripts/seed-demo.mjs --commit   → grava
//   node scripts/seed-demo.mjs --remover --commit  → apaga tudo que criou
//
// Decisões:
// - O bolão nasce com `listadoPublicamente: false`: é demonstração, não pode
//   aparecer na lista pública nem receber gente de fora.
// - O DONO é a conta que o Kirk já usa (nenhuma senha nova, nada passando por
//   script ou conversa). Ele abre /bolao-demonstracao e cai no painel.
// - Os participantes são docs de membro SEM conta no Auth: as telas do
//   organizador leem membros e cartelas, então isso basta para os prints. Se um
//   dia for preciso ver a tela do participante, aí sim cria-se uma conta.
// - Os jogos e placares são COPIADOS de uma rodada real, para as telas não
//   mostrarem confronto que não existe.

import { getAdminDb, FieldValue } from '../api/_shared/firebaseAdmin.js';
import { calcPoints } from '../api/_shared/scoring.js';
import { matchCountsForScoring } from '../api/_shared/matchStatus.js';

const COMMIT = process.argv.includes('--commit');
const REMOVER = process.argv.includes('--remover');

const TENANT = 'bolao-demonstracao';
const NOME = 'Bolão da Firma';
const DONO = 'Odto0fHHxOREM3FSi9AP';     // conta do Kirk (WhatsApp 11999999999)
const VALOR_CARTELA = 15;

const db = getAdminDb();
const log = (...a) => console.log(...a);
const acao = (txt) => log(`${COMMIT ? '  ✓' : '  ·'} ${txt}`);

// ── Elenco fictício ─────────────────────────────────────────────────────────
const PESSOAS = [
  ['Ricardo Alves', '64988110001'], ['Juliana Prado', '64988110002'],
  ['Marcos Tavares', '64988110003'], ['Camila Nogueira', '64988110004'],
  ['Anderson Luz', '64988110005'], ['Patrícia Rangel', '64988110006'],
  ['Fernando Braga', '64988110007'], ['Simone Duarte', '64988110008'],
  ['Rogério Pinto', '64988110009'], ['Letícia Campos', '64988110010'],
  ['Wagner Sales', '64988110011'], ['Débora Mattos', '64988110012'],
];

const PONTOS_DE_VENDA = [
  { id: 'demo-pdv-bar', name: 'Bar do Zé', contact: 'José Carlos', phone: '64988220001', commission: 5 },
  { id: 'demo-pdv-loterica', name: 'Lotérica Central', contact: 'Marlene', phone: '64988220002', commission: 5 },
];

const uidDe = (i) => `demo-participante-${String(i + 1).padStart(2, '0')}`;

// Palpite plausível: placares baixos, como jogo de verdade.
function placarPalpite(semente) {
  const a = [0, 1, 1, 2, 0, 2, 1, 3, 0, 1];
  const b = [0, 0, 1, 1, 2, 0, 2, 1, 1, 3];
  return [a[semente % a.length], b[(semente * 3) % b.length]];
}

async function remover() {
  log(`\nREMOVENDO ${TENANT}...`);
  for (const col of ['rounds', 'predictions', 'settings', 'public_config', 'establishments', 'communications']) {
    const snap = await db.collection(col).where('tenantId', '==', TENANT).get();
    acao(`${col}: ${snap.size} documento(s)`);
    if (COMMIT) for (const d of snap.docs) await d.ref.delete();
  }
  const membros = await db.collection('tenants').doc(TENANT).collection('members').get();
  acao(`members: ${membros.size}`);
  if (COMMIT) {
    for (const d of membros.docs) await d.ref.delete();
    await db.collection('tenants').doc(TENANT).delete();
  }
  acao('tenant apagado');
  log(COMMIT ? '\nPronto.' : '\n(simulação — use --commit)');
}

async function criar() {
  const existe = (await db.collection('tenants').doc(TENANT).get()).exists;
  if (existe) {
    log(`\nO bolão ${TENANT} já existe. Para refazer:`);
    log('   node scripts/seed-demo.mjs --remover --commit\n');
    process.exit(1);
  }

  log(`\nMONTANDO ${TENANT}${COMMIT ? '' : '  (simulação)'}\n`);

  // 1. Rodadas: copiadas de um bolão que já tem histórico real.
  const origem = await db.collection('rounds')
    .where('tenantId', '==', 'bolao-lion-tech').get();
  const rodadas = origem.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.number || 0) - (b.number || 0));

  const apurada = [...rodadas].reverse().find(r => r.status === 'finished' && r.matches?.some(m => m.homeScore != null));
  const proxima = rodadas.find(r => (r.number || 0) > (apurada?.number || 0) && r.matches?.length);

  // O doc de origem carrega o próprio id; copiar isso para outro documento
  // grava um campo `id` que não bate com a chave — e `id: undefined` o
  // Firestore recusa de cara.
  const semId = ({ id, ...resto }) => resto;
  if (!apurada || !proxima) { log('Não achei rodada apurada + próxima na origem.'); process.exit(1); }

  acao(`rodada apurada: R${apurada.number} (${apurada.matches.length} jogos)`);
  acao(`rodada aberta:  R${proxima.number} (${proxima.matches.length} jogos)`);

  const agora = Date.now();
  const trintaDias = 30 * 864e5;

  if (COMMIT) {
    await db.collection('tenants').doc(TENANT).set({
      name: NOME,
      plan: 'ativo',
      listadoPublicamente: false,
      demo: true,                       // marca para dar para achar e limpar depois
      ownerEmail: 'demo@brasilbolao.com.br',
      ownerWhatsapp: '',
      subscription: {
        status: 'active',
        trialEndsAt: agora,
        currentPeriodEnd: agora + trintaDias,
        priceCents: 2990,
        lastChargeId: null, pendingChargeId: null, blockedAt: null, lastNotifiedAt: null,
      },
      createdAt: FieldValue.serverTimestamp(),
    });

    await db.collection('tenants').doc(TENANT).collection('members').doc(DONO).set({
      role: 'owner', name: 'Kirk Douglas', whatsapp: '11999999999',
      email: '', establishmentId: null, createdAt: FieldValue.serverTimestamp(),
    });

    await db.collection('settings').add({
      tenantId: TENANT,
      brandName: NOME,
      betValue: VALOR_CARTELA,
      payment: { provider: 'pix_manual', pixKey: 'demo@brasilbolao.com.br', pixRecipientName: 'Bolão da Firma', methods: { pix: true, card: false } },
      betConfig: { minBet: 10, maxBet: 100, bonus: { enabled: false, percent: 0 }, fees: { adminPercent: 10, establishmentPercent: 5 }, typesLimitsText: '' },
      whatsapp: { number: '', groupJid: '' },
      maintenanceMode: false,
      createdAt: FieldValue.serverTimestamp(),
    });

    await db.collection('public_config').doc(TENANT).set({
      tenantId: TENANT, brandName: NOME, betValue: VALOR_CARTELA,
      slug: TENANT, slugPlano: TENANT.replace(/-/g, ''),
      payment: { pixKey: 'demo@brasilbolao.com.br', pixRecipientName: 'Bolão da Firma', methods: { pix: true, card: false } },
      wooviEnabled: false, maintenanceMode: false,
    });

    for (const pdv of PONTOS_DE_VENDA) {
      await db.collection('establishments').doc(pdv.id).set({ ...pdv, tenantId: TENANT, createdAt: FieldValue.serverTimestamp() });
    }
  }
  acao(`bolão, configurações e ${PONTOS_DE_VENDA.length} pontos de venda`);

  // 2. Participantes
  for (let i = 0; i < PESSOAS.length; i++) {
    const [nome, whats] = PESSOAS[i];
    // Um terço veio por ponto de venda, para o financeiro mostrar comissão.
    const pdv = i % 3 === 0 ? PONTOS_DE_VENDA[i % 2].id : null;
    if (COMMIT) {
      await db.collection('tenants').doc(TENANT).collection('members').doc(uidDe(i)).set({
        role: 'participant', name: nome, whatsapp: whats, email: '',
        establishmentId: pdv, createdAt: FieldValue.serverTimestamp(),
      });
    }
  }
  acao(`${PESSOAS.length} participantes (4 vinculados a ponto de venda)`);

  // 3. Rodadas do bolão de demonstração
  const idApurada = `demo-rodada-${apurada.number}`;
  const idAberta = `demo-rodada-${proxima.number}`;

  if (COMMIT) {
    await db.collection('rounds').doc(idApurada).set({
      ...semId(apurada), tenantId: TENANT,
      status: 'finished', resultadoCalculado: true, resultSentToGroup: true,
      createdAt: FieldValue.serverTimestamp(),
    });
    // A rodada aberta precisa fechar no futuro, senão nasce fechada.
    const daquiTresDias = new Date(agora + 3 * 864e5);
    await db.collection('rounds').doc(idAberta).set({
      ...semId(proxima), tenantId: TENANT,
      status: 'open', resultadoCalculado: false, resultSentToGroup: false,
      closeAt: daquiTresDias.toISOString(),
      matches: (proxima.matches || []).map(m => ({
        ...m, homeScore: null, awayScore: null, finished: false,
        date: new Date(agora + 3.2 * 864e5).toISOString(),
      })),
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  acao(`2 rodadas: R${apurada.number} apurada e R${proxima.number} aberta`);

  // 4. Cartelas
  const valendo = (apurada.matches || []).filter(matchCountsForScoring);
  let cartelasApuradas = 0, pagas = 0, docs = 0;

  for (let i = 0; i < PESSOAS.length; i++) {
    const [nome] = PESSOAS[i];
    const pdv = i % 3 === 0 ? PONTOS_DE_VENDA[i % 2].id : null;
    // Dois participantes jogam com duas cartelas — é comum e aparece no ranking.
    const quantas = (i === 2 || i === 7) ? 2 : 1;

    for (let c = 0; c < quantas; c++) {
      const cartela = `CART-DEMO-${String(i + 1).padStart(2, '0')}${c ? 'B' : 'A'}`;
      // 3 de 14 cartelas ficam sem pagar: é o que faz a tela de cobrança e o
      // "pendente" do financeiro terem o que mostrar.
      const paid = !(i === 4 || i === 9 || (i === 7 && c === 1));
      cartelasApuradas++; if (paid) pagas++;

      let pontos = 0;
      for (const m of valendo) {
        const [ph, pa] = placarPalpite(i * 7 + c * 3 + m.id);
        pontos += calcPoints(ph, pa, m.homeScore, m.awayScore);
        docs++;
        if (COMMIT) {
          await db.collection('predictions').add({
            tenantId: TENANT, userId: uidDe(i), roundId: idApurada, matchId: m.id,
            homeScore: ph, awayScore: pa, cartelaCode: cartela,
            establishmentId: pdv, finalized: true, paid,
            points: pontos, createdAt: FieldValue.serverTimestamp(),
          });
        }
      }
    }
  }
  acao(`R${apurada.number}: ${cartelasApuradas} cartelas (${pagas} pagas, ${cartelasApuradas - pagas} pendentes), ${docs} palpites`);

  // 5. Rodada aberta: 8 dos 12 já palpitaram — sobra gente para o lembrete.
  let abertas = 0;
  for (let i = 0; i < 8; i++) {
    const pdv = i % 3 === 0 ? PONTOS_DE_VENDA[i % 2].id : null;
    const cartela = `CART-DEMO-${String(i + 1).padStart(2, '0')}A`;
    abertas++;
    for (const m of (proxima.matches || [])) {
      const [ph, pa] = placarPalpite(i * 5 + m.id);
      if (COMMIT) {
        await db.collection('predictions').add({
          tenantId: TENANT, userId: uidDe(i), roundId: idAberta, matchId: m.id,
          homeScore: ph, awayScore: pa, cartelaCode: cartela,
          establishmentId: pdv, finalized: true, paid: i < 5,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    }
  }
  acao(`R${proxima.number}: ${abertas} cartelas enviadas, 4 participantes ainda sem palpitar`);

  log(COMMIT
    ? `\nPronto. Abra https://brasilbolao.com.br/${TENANT} logado como 11999999999.\n`
    : `\n(simulação — nada foi gravado. Rode com --commit)\n`);
}

await (REMOVER ? remover() : criar());
process.exit(0);
