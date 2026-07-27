// Inicialização do Firebase Admin SDK para as funções serverless.
// O Admin SDK IGNORA as regras do Firestore (backend confiável), então é assim
// que os crons, o webhook de pagamento e os endpoints de admin acessam os dados.
//
// Credencial: variável FIREBASE_SERVICE_ACCOUNT (JSON) em produção (Vercel);
// em desenvolvimento, cai para o arquivo serviceAccountKey.json na raiz.

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { readFileSync } from 'node:fs';

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    try { return JSON.parse(raw); }
    catch { throw new Error('FIREBASE_SERVICE_ACCOUNT inválido (esperado JSON)'); }
  }
  try {
    return JSON.parse(readFileSync(new URL('../../serviceAccountKey.json', import.meta.url)));
  } catch {
    throw new Error('Credencial admin ausente: defina FIREBASE_SERVICE_ACCOUNT ou coloque serviceAccountKey.json na raiz');
  }
}

let _app;
function adminApp() {
  if (_app) return _app;
  _app = getApps().find(a => a.name === 'admin')
    || initializeApp({ credential: cert(loadServiceAccount()) }, 'admin');
  return _app;
}

export function getAdminAuth() { return getAuth(adminApp()); }
export function getAdminDb() { return getFirestore(adminApp()); }
export function getAdminStorage() { return getStorage(adminApp()); }
export { FieldValue };
