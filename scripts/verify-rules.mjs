/**
 * Verificação automatizada das regras do Firestore contra o projeto real.
 * Entra via Firebase Auth como admin e como usuário comum e testa cada operação,
 * confirmando o que DEVE passar e o que DEVE ser bloqueado. Não deixa lixo (limpa
 * o que cria). USO: ADMIN_PWD=xxxx node scripts/verify-rules.mjs
 *
 * Multi-tenant (Fase 2): listas de coleções escopadas SÓ passam com filtro
 * where('tenantId'=='...') e se o usuário for membro do tenant.
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, collection, getDocs, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, query, where } from 'firebase/firestore';

const cfg = {
  apiKey: 'AIzaSyCDEbEF3wQQck2bbIZfW1tCNROJzJ39cXQ',
  authDomain: 'bolao-brasileirao-dev-kd.firebaseapp.com',
  projectId: 'bolao-brasileirao-dev-kd',
  storageBucket: 'bolao-brasileirao-dev-kd.firebasestorage.app',
  messagingSenderId: '1084218540237',
  appId: '1:1084218540237:web:3e9b1d8d194a2e93472984',
};
const app = initializeApp(cfg);
const auth = getAuth(app);
const db = getFirestore(app);
const email = (wpp) => `${wpp}@bolao.users`;

const TENANT_ID = 'bolao-lion-tech';
const byTenant = (col, tid = TENANT_ID) => query(collection(db, col), where('tenantId', '==', tid));

// Credenciais do admin lidas do ambiente (nunca hardcode senha no repo).
const ADMIN_WPP = process.env.ADMIN_WPP || '11999999999';
const ADMIN_PWD = process.env.ADMIN_PWD;
if (!ADMIN_PWD) {
  console.error('Defina a senha do admin: ADMIN_PWD=xxxx node scripts/verify-rules.mjs');
  process.exit(1);
}

let pass = 0, fail = 0;
async function check(label, expect, fn) {
  // expect: 'allow' => deve funcionar | 'deny' => deve ser bloqueado
  try {
    const r = await fn();
    if (expect === 'allow') { console.log(`  OK   ${label}`); pass++; }
    else { console.log(`  FALHA ${label} — deveria ser BLOQUEADO mas passou`); fail++; }
    return r;
  } catch (e) {
    const denied = (e.code || '').includes('permission-denied') || /insufficient permissions/i.test(e.message);
    if (expect === 'deny' && denied) { console.log(`  OK   ${label} (bloqueado, como esperado)`); pass++; }
    else if (expect === 'allow') { console.log(`  FALHA ${label} — ${e.code || e.message}`); fail++; }
    else { console.log(`  ?    ${label} — erro inesperado: ${e.code || e.message}`); fail++; }
    return null;
  }
}

async function run() {
  // ── ADMIN (owner do tenant padrão) ─────────────────────────────────────
  console.log(`\n[ADMIN] ${ADMIN_WPP}`);
  await signInWithEmailAndPassword(auth, email(ADMIN_WPP), ADMIN_PWD);
  await check('ler /users (lista)', 'allow', () => getDocs(collection(db, 'users')));
  await check('ler /settings filtrado por tenant', 'allow', () => getDocs(byTenant('settings')));
  await check('ler /settings SEM filtro — deve negar', 'deny', () => getDocs(collection(db, 'settings')));
  await check('ler /rounds filtrado por tenant', 'allow', () => getDocs(byTenant('rounds')));
  await check('ler /rounds SEM filtro — deve negar', 'deny', () => getDocs(collection(db, 'rounds')));
  await check('ler /public_config', 'allow', () => getDoc(doc(db, 'public_config', 'main')));
  await check('ler próprio doc de membro', 'allow', () => getDoc(doc(db, 'tenants', TENANT_ID, 'members', auth.currentUser.uid)));
  await signOut(auth);

  // ── USUÁRIO COMUM (descartável, criado e removido nesta verificação) ─────
  const botWpp = '11900000000';
  console.log(`\n[USUÁRIO] ${botWpp} (bot de verificação, descartável)`);
  let uid = null;
  await check('cadastro cria conta + doc próprio (isAdmin:false)', 'allow', async () => {
    const cred = await createUserWithEmailAndPassword(auth, email(botWpp), 'verify123456');
    uid = cred.user.uid;
    return setDoc(doc(db, 'users', uid), { name: 'VERIFY BOT', whatsapp: botWpp, isAdmin: false, balance: 0 });
  });
  if (uid) {
    await check('self-join no tenant como participant', 'allow', () =>
      setDoc(doc(db, 'tenants', TENANT_ID, 'members', uid), { role: 'participant', name: 'VERIFY BOT' }));
    await check('self-join como OWNER — deve negar', 'deny', () =>
      setDoc(doc(db, 'tenants', TENANT_ID, 'members', uid), { role: 'owner', name: 'VERIFY BOT' }));

    await check('ler /rounds do tenant (filtrado)', 'allow', () => getDocs(byTenant('rounds')));
    await check('ler /rounds SEM filtro — deve negar', 'deny', () => getDocs(collection(db, 'rounds')));
    await check('ler /rounds de OUTRO tenant — deve negar', 'deny', () => getDocs(byTenant('rounds', 'outro-tenant')));
    await check('ler /predictions do tenant (ranking)', 'allow', () => getDocs(byTenant('predictions')));
    await check('ler /users (nomes p/ ranking)', 'allow', () => getDocs(collection(db, 'users')));
    await check('ler /public_config', 'allow', () => getDoc(doc(db, 'public_config', 'main')));
    await check('ler /settings do tenant (segredos) — deve negar', 'deny', () => getDocs(byTenant('settings')));
    await check('listar membros do tenant', 'allow', () => getDocs(collection(db, 'tenants', TENANT_ID, 'members')));

    // Escrita: criar palpite próprio não-pago (deve permitir) e limpar depois.
    let createdId = null;
    await check('criar palpite próprio (paid:false, com tenantId)', 'allow', async () => {
      const r = await addDoc(collection(db, 'predictions'), {
        tenantId: TENANT_ID, userId: uid, roundId: 'VERIFY', matchId: 'VERIFY',
        homeScore: 0, awayScore: 0, paid: false, cartelaCode: 'VERIFY-TEST',
      });
      createdId = r.id; return r;
    });
    await check('criar palpite SEM tenantId — deve negar', 'deny', () =>
      addDoc(collection(db, 'predictions'), { userId: uid, roundId: 'X', matchId: 'X', paid: false }));
    // Marcar o próprio palpite como pago (deve NEGAR).
    if (createdId) {
      await check('marcar palpite como pago — deve negar', 'deny',
        () => updateDoc(doc(db, 'predictions', createdId), { paid: true, statusPagamento: 'pago' }));
      await check('apagar o próprio palpite não-pago (limpeza)', 'allow',
        () => deleteDoc(doc(db, 'predictions', createdId)));
    }
    // Tornar-se admin (deve NEGAR).
    await check('elevar-se a admin no próprio doc — deve negar', 'deny',
      () => updateDoc(doc(db, 'users', uid), { isAdmin: true }));
    // Criar palpite em nome de OUTRO usuário (deve NEGAR).
    await check('criar palpite para outro userId — deve negar', 'deny',
      () => addDoc(collection(db, 'predictions'), { tenantId: TENANT_ID, userId: 'OUTRO', roundId: 'X', matchId: 'X', paid: false }));
    // Auto-remoção da conta Auth do bot (self-delete é permitido).
    try { await auth.currentUser.delete(); } catch {}
    await signOut(auth);
  }

  // Limpeza dos docs do bot (só admin/owner pode apagar /users e members).
  if (uid) {
    try {
      await signInWithEmailAndPassword(auth, email(ADMIN_WPP), ADMIN_PWD);
      await deleteDoc(doc(db, 'tenants', TENANT_ID, 'members', uid));
      await deleteDoc(doc(db, 'users', uid));
      console.log('  (limpeza) docs do bot removidos pelo admin');
      await signOut(auth);
    } catch (e) { console.log(`  (limpeza) não removeu docs do bot: ${e.code || e.message}`); }
  }

  // ── NÃO AUTENTICADO ────────────────────────────────────────────────────
  console.log('\n[SEM LOGIN]');
  await check('ler /users sem login — deve negar', 'deny', () => getDocs(collection(db, 'users')));
  await check('ler /rounds do tenant sem login — deve negar', 'deny', () => getDocs(byTenant('rounds')));
  await check('ler /public_config sem login (branding)', 'allow', () => getDoc(doc(db, 'public_config', 'main')));
  await check('ler /establishments sem login (cadastro)', 'allow', () => getDocs(byTenant('establishments')));

  console.log(`\nResultado: ${pass} OK, ${fail} FALHA(S)`);
  process.exit(fail ? 1 : 0);
}
run().catch(e => { console.error('Erro fatal:', e); process.exit(2); });
