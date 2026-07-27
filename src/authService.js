// Serviço de autenticação via Firebase Auth.
// Usa email sintético derivado do WhatsApp: <digitos>@bolao.users
// O uid do Auth é igual ao ID do documento em /users (garantido na migração e no cadastro).

import { initializeApp, getApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged, updatePassword,
  EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { app } from './firebase.js';

const EMAIL_DOMAIN = 'bolao.users';

export function whatsappToEmail(whatsapp) {
  const digits = String(whatsapp || '').replace(/\D/g, '');
  return digits ? `${digits}@${EMAIL_DOMAIN}` : null;
}

// Usa explicitamente o app inicializado em firebase.js (sem depender de ordem de import).
function auth() { return getAuth(app); }
function db() { return getFirestore(app); }

// Faz login e retorna o doc de /users (com id). Lança erro em credenciais inválidas.
export async function loginWithWhatsapp(whatsapp, password) {
  const email = whatsappToEmail(whatsapp);
  if (!email) throw new Error('WhatsApp inválido');
  const cred = await signInWithEmailAndPassword(auth(), email, password);
  const uid = cred.user.uid;
  const snap = await getDoc(doc(db(), 'users', uid));
  if (!snap.exists()) throw new Error('Usuário autenticado sem cadastro. Contate o administrador.');
  const tokenResult = await cred.user.getIdTokenResult();
  return { id: uid, ...snap.data(), isAdmin: tokenResult.claims.admin === true || !!snap.data().isAdmin };
}

// Cadastra novo usuário: cria no Auth e grava /users/{uid} sem senha em texto.
export async function registerWithWhatsapp({ name, whatsapp, password, establishmentId }) {
  const email = whatsappToEmail(whatsapp);
  if (!email) throw new Error('WhatsApp inválido');
  const cred = await createUserWithEmailAndPassword(auth(), email, password);
  const uid = cred.user.uid;
  const data = {
    name,
    whatsapp: String(whatsapp).replace(/\D/g, ''),
    isAdmin: false,
    balance: 0,
    establishmentId: establishmentId || null,
    createdAt: serverTimestamp(),
  };
  await setDoc(doc(db(), 'users', uid), data);
  return { id: uid, ...data };
}

export async function logout() {
  await signOut(auth());
}

// Token do usuário logado, para autenticar chamadas a endpoints admin serverless.
export async function getIdToken() {
  const u = auth().currentUser;
  return u ? await u.getIdToken() : null;
}

// Admin cria usuário SEM perder a própria sessão: usa um app Firebase secundário.
// Retorna o uid criado no Auth (o doc /users/{uid} é gravado por quem chama).
// Obs: definir isAdmin=true para o novo usuário exige custom claim via Admin SDK
// (não é possível pelo cliente) — o campo isAdmin no doc não concede privilégio real.
export async function adminCreateUser({ whatsapp, password }) {
  const email = whatsappToEmail(whatsapp);
  if (!email) throw new Error('WhatsApp inválido');
  const secondary = initializeApp(getApp().options, 'secondary-' + Date.now());
  try {
    const secAuth = getAuth(secondary);
    const cred = await createUserWithEmailAndPassword(secAuth, email, password);
    const uid = cred.user.uid;
    await signOut(secAuth);
    return uid;
  } finally {
    await deleteApp(secondary);
  }
}

export function observeAuth(callback) {
  return onAuthStateChanged(auth(), callback);
}

// Troca de senha do usuário logado (o admin usa o painel/Admin SDK para outros).
export async function changeOwnPassword(newPassword) {
  const u = auth().currentUser;
  if (!u) throw new Error('Não autenticado');
  await updatePassword(u, newPassword);
}

// Troca segura da própria senha: reautentica com a senha ATUAL antes de trocar.
// Evita o erro requires-recent-login e confirma que o usuário conhece a senha atual.
export async function changeMyPassword(currentPassword, newPassword) {
  const u = auth().currentUser;
  if (!u || !u.email) throw new Error('Não autenticado');
  const cred = EmailAuthProvider.credential(u.email, currentPassword);
  await reauthenticateWithCredential(u, cred);
  await updatePassword(u, newPassword);
}

// Traduz códigos de erro do Firebase Auth para mensagens em pt-BR.
export function authErrorMessage(err) {
  const code = err?.code || '';
  const map = {
    'auth/invalid-credential': 'WhatsApp ou senha incorretos',
    'auth/wrong-password': 'WhatsApp ou senha incorretos',
    'auth/user-not-found': 'WhatsApp ou senha incorretos',
    'auth/invalid-email': 'WhatsApp inválido',
    'auth/email-already-in-use': 'WhatsApp já cadastrado',
    'auth/weak-password': 'Senha muito fraca (mínimo 6 caracteres)',
    'auth/too-many-requests': 'Muitas tentativas. Tente novamente mais tarde.',
    'auth/network-request-failed': 'Falha de conexão. Verifique a internet.',
  };
  return map[code] || err?.message || 'Erro de autenticação';
}
