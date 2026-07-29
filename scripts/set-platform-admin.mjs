// Marca uma conta como operadora da plataforma (users.platformAdmin) e grava a
// claim equivalente no token. O papel é separado de ser dono de um bolão.
//
// Uso: node scripts/set-platform-admin.mjs <uid> [--remover]
import fs from 'fs';
import admin from 'firebase-admin';

const uid = process.argv[2];
const remover = process.argv.includes('--remover');
if (!uid) { console.log('Informe o uid. Ex.: node scripts/set-platform-admin.mjs Odto0fHHxOREM3FSi9AP'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'))) });
const db = admin.firestore();

const snap = await db.collection('users').doc(uid).get();
if (!snap.exists) { console.log('Usuário não encontrado:', uid); process.exit(1); }

const valor = !remover;
await db.collection('users').doc(uid).update({ platformAdmin: valor });
// A claim vale no token e não depende de leitura do Firestore nas regras.
await admin.auth().setCustomUserClaims(uid, { platformAdmin: valor });

console.log(`${snap.data().name || uid}: platformAdmin = ${valor}`);
console.log('A claim entra no token na próxima renovação (relogar garante).');
process.exit(0);
