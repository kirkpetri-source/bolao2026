/**
 * Remove o campo `password` (hash bcrypt legado) dos docs /users.
 * As senhas passaram a ser geridas pelo Firebase Auth; o campo no Firestore
 * é exposto a qualquer autenticado (leitura de /users p/ ranking) e deve sair.
 *
 * Entra como admin (que tem permissão de update em /users nas regras).
 * USO: node scripts/strip-user-passwords.mjs
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, collection, getDocs, doc, updateDoc, deleteField } from 'firebase/firestore';

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

// Credenciais do admin lidas do ambiente (nunca hardcode senha no repo).
// USO: ADMIN_PWD=suaSenha node scripts/strip-user-passwords.mjs
const ADMIN_WPP = process.env.ADMIN_WPP || '11999999999';
const ADMIN_PWD = process.env.ADMIN_PWD;
if (!ADMIN_PWD) {
  console.error('Defina a senha do admin: ADMIN_PWD=xxxx node scripts/strip-user-passwords.mjs');
  process.exit(1);
}

await signInWithEmailAndPassword(auth, `${ADMIN_WPP}@bolao.users`, ADMIN_PWD);
const snap = await getDocs(collection(db, 'users'));
let cleaned = 0;
for (const d of snap.docs) {
  if (d.data().password !== undefined) {
    await updateDoc(doc(db, 'users', d.id), { password: deleteField() });
    cleaned++;
    console.log(`  limpo: ${d.id}`);
  }
}
console.log(`Concluído. ${cleaned} doc(s) com senha removida de ${snap.size} usuários.`);
await signOut(auth);
process.exit(0);
