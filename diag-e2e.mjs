// Testes ponta a ponta contra PRODUCAO. Chama os endpoints publicados (que tem
// as credenciais reais) — nunca usa chave lida de env baixada, que vem redigida.
import fs from 'fs';
import admin from 'firebase-admin';

const ROOT = 'C:/Users/Predator/Documents/Sistemas construidos/bolao-brasileirao-2025-dev';
const API_KEY = 'AIzaSyCDEbEF3wQQck2bbIZfW1tCNROJzJ39cXQ';
const BASE = 'https://bolao-brasileirao-2025-dev.vercel.app';
const TENANT = 'bolao-do-kirk';

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(`${ROOT}/serviceAccountKey.json`, 'utf8'))) });
const db = admin.firestore();

async function tokenDe(uid) {
  const custom = await admin.auth().createCustomToken(uid);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  return (await r.json()).idToken;
}

async function post(rota, corpo) {
  const r = await fetch(`${BASE}${rota}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const ok = (b, t) => console.log(`${b ? 'PASSOU' : 'FALHOU'}  ${t}`);

// ── quem é quem ───────────────────────────────────────────────────────────────
const tSnap = await db.collection('tenants').doc(TENANT).get();
const ownerId = tSnap.data().ownerId;
const admins = await db.collection('users').where('isAdmin', '==', true).limit(1).get();
const adminId = admins.empty ? null : admins.docs[0].id;
console.log(`owner do ${TENANT}: ${ownerId ? 'ok' : 'AUSENTE'} | admin global: ${adminId ? 'ok' : 'AUSENTE'}\n`);

const tokenOwner = await tokenDe(ownerId);
const tokenAdmin = adminId ? await tokenDe(adminId) : null;

// ── 1. painel da plataforma ───────────────────────────────────────────────────
console.log('--- PAINEL DA PLATAFORMA ---');
const semAuth = await post('/api/admin/tenants', {});
ok(semAuth.status === 400, `sem idToken responde 400 (${semAuth.status})`);

const comOwner = await post('/api/admin/tenants', { idToken: tokenOwner });
ok(comOwner.status === 403, `dono de bolao NAO ve a carteira: 403 (${comOwner.status})`);

if (tokenAdmin) {
  const comAdmin = await post('/api/admin/tenants', { idToken: tokenAdmin });
  ok(comAdmin.status === 200, `admin global ve: 200 (${comAdmin.status})`);
  if (comAdmin.status === 200) {
    const { resumo, boloes } = comAdmin.body;
    ok(typeof resumo.mrrCentavos === 'number', `MRR calculado: R$ ${(resumo.mrrCentavos/100).toFixed(2)}`);
    ok(Array.isArray(boloes) && boloes.length >= 2, `lista com ${boloes.length} boloes`);
    const plat = boloes.find(b => b.status === 'plataforma');
    ok(!!plat, 'bolao da propria Lion Tech marcado como plataforma (nao cobrado)');
    console.log(`   resumo: ativos=${resumo.ativos} teste=${resumo.emTeste} vencidos=${resumo.vencidos} bloqueados=${resumo.bloqueados}`);
  }
}

// ── 2. validacao de CPF/CNPJ no endpoint ──────────────────────────────────────
console.log('\n--- RECORRENCIA: VALIDACAO ---');
const docRuim = await post('/api/billing/recurrence', { idToken: tokenOwner, tenantId: TENANT, enabled: true, taxID: '11111111111' });
ok(docRuim.status === 400, `CPF invalido recusado: 400 (${docRuim.status}) — ${docRuim.body.error || ''}`);

const semDoc = await post('/api/billing/recurrence', { idToken: tokenOwner, tenantId: TENANT, enabled: true });
ok(semDoc.status === 400, `sem documento recusado: 400 (${semDoc.status})`);

const naoDono = tokenAdmin ? await post('/api/billing/recurrence', { idToken: tokenAdmin, tenantId: TENANT, enabled: true, taxID: '44124574000147' }) : null;
if (naoDono) ok(naoDono.status === 403, `quem nao e dono do bolao nao mexe: 403 (${naoDono.status})`);

// ── 3. recorrencia de verdade na Woovi ────────────────────────────────────────
console.log('\n--- RECORRENCIA: CICLO REAL NA WOOVI ---');
const ligar = await post('/api/billing/recurrence', { idToken: tokenOwner, tenantId: TENANT, enabled: true, taxID: '44124574000147' });
ok(ligar.status === 200, `ligar: HTTP ${ligar.status} ${ligar.status !== 200 ? JSON.stringify(ligar.body).slice(0,200) : ''}`);
if (ligar.status === 200) {
  console.log(`   assinatura criada: ${ligar.body.subscriptionId} | dia de cobranca: ${ligar.body.dayGenerateCharge}`);
  const dep = (await db.collection('tenants').doc(TENANT).get()).data().subscription;
  ok(dep.recurring === true && !!dep.wooviSubscriptionId, 'gravado no bolao: recurring + id da assinatura');
  ok(!!dep.trialEndsAt, 'datas do teste preservadas ao ligar a recorrencia');

  const desligar = await post('/api/billing/recurrence', { idToken: tokenOwner, tenantId: TENANT, enabled: false });
  ok(desligar.status === 200, `desligar: HTTP ${desligar.status} ${desligar.status !== 200 ? JSON.stringify(desligar.body).slice(0,200) : ''}`);
  const fim = (await db.collection('tenants').doc(TENANT).get()).data().subscription;
  ok(fim.recurring === false && !fim.wooviSubscriptionId, 'desligado e limpo no bolao');
  ok(!!fim.trialEndsAt, 'datas do teste preservadas ao desligar');
}

// ── 4. cobranca avulsa segue funcionando ──────────────────────────────────────
console.log('\n--- COBRANCA AVULSA ---');
const avulsa = await post('/api/billing/subscribe', { idToken: tokenOwner, tenantId: TENANT });
ok(avulsa.status === 200 && !!avulsa.body.qrCodeImage, `PIX gerado: HTTP ${avulsa.status}, R$ ${(avulsa.body.value/100 || 0).toFixed(2)}`);

process.exit(0);
