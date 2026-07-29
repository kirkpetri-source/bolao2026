// Cria a conta que opera a plataforma, com e-mail real e senha definida pelo
// próprio dono — a senha nunca é digitada aqui nem fica em lugar nenhum.
//
// A conta nasce com uma senha aleatória descartável e o script devolve um link
// de definição de senha do Firebase. Quem abrir o link escolhe a senha.
//
// Também tira o papel de plataforma da conta antiga, se ela for informada:
// operar o SaaS e ser dono de um bolão passam a ser contas separadas.
//
// Uso:
//   node scripts/criar-conta-plataforma.mjs <email> "<Nome>" [--tirar-de <uid>]
import crypto from 'crypto';
import fs from 'fs';
import admin from 'firebase-admin';

const email = String(process.argv[2] || '').trim().toLowerCase();
const nome = process.argv[3] || 'Administrador da plataforma';
const i = process.argv.indexOf('--tirar-de');
const uidAntigo = i > -1 ? process.argv[i + 1] : null;

if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.log('Uso: node scripts/criar-conta-plataforma.mjs <email> "<Nome>" [--tirar-de <uid>]');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'))) });
const auth = admin.auth();
const db = admin.firestore();

let user;
try {
  user = await auth.getUserByEmail(email);
  console.log(`Conta já existia: ${user.uid}`);
} catch {
  user = await auth.createUser({
    email,
    // Descartável: só existe para o cadastro não nascer sem senha. Ninguém a usa.
    password: crypto.randomBytes(32).toString('base64url'),
    displayName: nome,
    emailVerified: false,
  });
  console.log(`Conta criada: ${user.uid}`);
}

// O uid do Auth é o id do doc em /users — o app depende disso.
await db.collection('users').doc(user.uid).set({
  name: nome,
  email,
  platformAdmin: true,
  isAdmin: false,
  // Sem bolão: esta conta não administra bolão nenhum, só a plataforma.
  createdAt: admin.firestore.FieldValue.serverTimestamp(),
}, { merge: true });
await auth.setCustomUserClaims(user.uid, { platformAdmin: true });
console.log('Papel de plataforma aplicado (doc + claim).');

if (uidAntigo) {
  await db.collection('users').doc(uidAntigo).update({ platformAdmin: false });
  const antes = (await auth.getUser(uidAntigo)).customClaims || {};
  await auth.setCustomUserClaims(uidAntigo, { ...antes, platformAdmin: false });
  console.log(`Papel de plataforma REMOVIDO de ${uidAntigo} — ela segue apenas como dona do bolão dela.`);
}

const link = await auth.generatePasswordResetLink(email);
console.log('\n════ ABRA ESTE LINK PARA DEFINIR SUA SENHA ════');
console.log(link);
console.log('\nDepois entre em /plataforma com o e-mail e a senha que você escolher.');
process.exit(0);
