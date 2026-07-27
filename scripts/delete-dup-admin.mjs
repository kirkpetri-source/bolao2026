/**
 * Remove o DOC de admin duplicado (registro cadastral), mantendo a conta de login.
 * Seguro: aborta se o alvo for a conta de login do admin.
 * USO: node scripts/delete-dup-admin.mjs
 */
import { getAdminAuth, getAdminDb } from '../api/_shared/firebaseAdmin.js';

const DUP = 'Tzquh6ATuw0LV30FXZHt';       // doc duplicado a remover
const ADMIN_EMAIL = '11999999999@bolao.users';

const db = getAdminDb();
const auth = getAdminAuth();

const loginUid = (await auth.getUserByEmail(ADMIN_EMAIL)).uid;
if (loginUid === DUP) {
  console.log('ABORTADO: o alvo é a conta de LOGIN do admin. Nada foi excluído.');
  process.exit(1);
}

const preds = await db.collection('predictions').where('userId', '==', DUP).get();
if (!preds.empty) {
  console.log(`ABORTADO: o doc ${DUP} tem ${preds.size} palpite(s) vinculado(s). Revise antes de excluir.`);
  process.exit(1);
}

await db.collection('users').doc(DUP).delete();
console.log('Doc de admin duplicado removido:', DUP);

const admins = await db.collection('users').where('isAdmin', '==', true).get();
console.log('Admins restantes:', admins.size);
admins.forEach(d => console.log('  ', d.id, '|', d.data().name, '|', d.data().whatsapp));

const still = await auth.getUserByEmail(ADMIN_EMAIL);
console.log('Conta de login intacta:', still.uid === loginUid ? 'SIM' : 'ATENÇÃO: mudou!');
process.exit(0);
