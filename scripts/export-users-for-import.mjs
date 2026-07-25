/**
 * Exporta os usuários do Firestore para o formato do `firebase auth:import`.
 *
 * NÃO precisa de service account: usa o SDK cliente (mesma config do app) e a
 * importação usa o Firebase CLI já logado. Requer apenas que as regras atuais do
 * Firestore permitam leitura de /users (é o caso ANTES de aplicar as novas regras).
 *
 * USO:
 *   node scripts/export-users-for-import.mjs
 *   firebase auth:import users-import.json --hash-algo=BCRYPT
 *
 * Gera users-import.json (contém hashes bcrypt — está no .gitignore).
 * O localId (uid do Auth) = ID do doc no Firestore, mantendo uid == docId.
 */

import { writeFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || 'AIzaSyCDEbEF3wQQck2bbIZfW1tCNROJzJ39cXQ',
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || 'bolao-brasileirao-dev-kd.firebaseapp.com',
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || 'bolao-brasileirao-dev-kd',
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || 'bolao-brasileirao-dev-kd.firebasestorage.app',
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '1084218540237',
  appId: process.env.VITE_FIREBASE_APP_ID || '1:1084218540237:web:3e9b1d8d194a2e93472984',
};

const EMAIL_DOMAIN = 'bolao.users';
function whatsappToEmail(whatsapp) {
  const digits = String(whatsapp || '').replace(/\D/g, '');
  return digits ? `${digits}@${EMAIL_DOMAIN}` : null;
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const snap = await getDocs(collection(db, 'users'));
const users = [];
const skipped = [];

snap.forEach((docSnap) => {
  const u = docSnap.data();
  const email = whatsappToEmail(u.whatsapp);
  const hash = u.password || '';
  if (!email) { skipped.push(`${docSnap.id}: sem whatsapp`); return; }
  if (!/^\$2[aby]\$/.test(hash)) { skipped.push(`${docSnap.id}: senha não-bcrypt (legada) — usuário precisa redefinir`); return; }
  users.push({
    localId: docSnap.id,
    email,
    emailVerified: true,
    displayName: u.name || undefined,
    // passwordHash em base64 dos bytes do hash bcrypt (exigência do auth:import).
    passwordHash: Buffer.from(hash, 'utf8').toString('base64'),
  });
});

writeFileSync('users-import.json', JSON.stringify({ users }, null, 2));
console.log(`Exportados ${users.length} usuários para users-import.json`);
if (skipped.length) {
  console.log(`Pulados ${skipped.length}:`);
  skipped.forEach(s => console.log('  - ' + s));
}
console.log('\nAgora rode:\n  firebase auth:import users-import.json --hash-algo=BCRYPT\n');
process.exit(0);
