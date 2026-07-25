/**
 * Verificação automatizada das regras do Firestore contra o projeto real.
 * Entra via Firebase Auth como admin e como usuário comum e testa cada operação,
 * confirmando o que DEVE passar e o que DEVE ser bloqueado. Não deixa lixo (limpa
 * o que cria). USO: node scripts/verify-rules.mjs
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, collection, getDocs, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc } from 'firebase/firestore';

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

// Credenciais do admin lidas do ambiente (nunca hardcode senha no repo).
// USO: ADMIN_PWD=suaSenha node scripts/verify-rules.mjs
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
  // ── ADMIN ──────────────────────────────────────────────────────────────
  console.log(`\n[ADMIN] ${ADMIN_WPP}`);
  await signInWithEmailAndPassword(auth, email(ADMIN_WPP), ADMIN_PWD);
  await check('ler /users (lista)', 'allow', () => getDocs(collection(db, 'users')));
  await check('ler /settings (segredos)', 'allow', () => getDocs(collection(db, 'settings')));
  await check('ler /rounds', 'allow', () => getDocs(collection(db, 'rounds')));
  await check('ler /public_config', 'allow', () => getDoc(doc(db, 'public_config', 'main')));
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
    await check('ler /rounds', 'allow', () => getDocs(collection(db, 'rounds')));
    await check('ler /predictions (ranking)', 'allow', () => getDocs(collection(db, 'predictions')));
    await check('ler /users (nomes p/ ranking)', 'allow', () => getDocs(collection(db, 'users')));
    await check('ler /public_config', 'allow', () => getDoc(doc(db, 'public_config', 'main')));
    await check('ler /settings (segredos) — deve negar', 'deny', () => getDocs(collection(db, 'settings')));

    // Escrita: criar palpite próprio não-pago (deve permitir) e limpar depois.
    let createdId = null;
    await check('criar palpite próprio (paid:false)', 'allow', async () => {
      const r = await addDoc(collection(db, 'predictions'), {
        userId: uid, roundId: 'VERIFY', matchId: 'VERIFY', homeScore: 0, awayScore: 0,
        paid: false, cartelaCode: 'VERIFY-TEST',
      });
      createdId = r.id; return r;
    });
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
      () => addDoc(collection(db, 'predictions'), { userId: 'OUTRO', roundId: 'X', matchId: 'X', paid: false }));
    // Auto-remoção da conta Auth do bot (self-delete é permitido).
    try { await auth.currentUser.delete(); } catch {}
    await signOut(auth);
  }

  // Limpeza do doc do bot (só admin pode apagar /users).
  if (uid) {
    try {
      await signInWithEmailAndPassword(auth, email(ADMIN_WPP), ADMIN_PWD);
      await deleteDoc(doc(db, 'users', uid));
      console.log('  (limpeza) doc do bot removido pelo admin');
      await signOut(auth);
    } catch (e) { console.log(`  (limpeza) não removeu doc do bot: ${e.code || e.message}`); }
  }

  // ── NÃO AUTENTICADO ────────────────────────────────────────────────────
  console.log('\n[SEM LOGIN]');
  await check('ler /users sem login — deve negar', 'deny', () => getDocs(collection(db, 'users')));
  await check('ler /public_config sem login (branding)', 'allow', () => getDoc(doc(db, 'public_config', 'main')));
  await check('ler /establishments sem login (cadastro)', 'allow', () => getDocs(collection(db, 'establishments')));

  console.log(`\nResultado: ${pass} OK, ${fail} FALHA(S)`);
  process.exit(fail ? 1 : 0);
}
run().catch(e => { console.error('Erro fatal:', e); process.exit(2); });
