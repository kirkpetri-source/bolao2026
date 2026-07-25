// Shim de compatibilidade: expõe a API do SDK cliente do Firestore
// (collection, getDocs, doc, ...) implementada sobre o Admin SDK.
// Assim as funções serverless continuam com o mesmo código, apenas trocando
// o import de 'firebase/firestore' para '../_shared/firestore.js'.
//
// O Admin SDK ignora as regras de segurança (backend confiável).

import { getAdminDb, FieldValue } from './firebaseAdmin.js';

export const db = getAdminDb();

export function collection(database, name) { return database.collection(name); }
export function doc(database, name, id) { return database.collection(name).doc(id); }

export async function getDocs(refOrQuery) { return await refOrQuery.get(); }

// getDoc: o Admin retorna .exists como propriedade booleana; o cliente usa .exists()
// como método. Envolvemos para manter a API do cliente.
export async function getDoc(ref) {
  const s = await ref.get();
  return { exists: () => s.exists, data: () => s.data(), id: s.id, ref: s.ref };
}

export async function addDoc(collRef, data) { return await collRef.add(data); }
export async function updateDoc(ref, data) { return await ref.update(data); }
export async function setDoc(ref, data, opts) { return await ref.set(data, opts || {}); }
export async function deleteDoc(ref) { return await ref.delete(); }

export function where(field, op, value) { return { __where: true, field, op, value }; }
export function orderBy(field, dir) { return { __orderBy: true, field, dir: dir || 'asc' }; }
export function limit(n) { return { __limit: true, n }; }

export function query(base, ...constraints) {
  return constraints.reduce((q, c) => {
    if (c && c.__where) return q.where(c.field, c.op, c.value);
    if (c && c.__orderBy) return q.orderBy(c.field, c.dir);
    if (c && c.__limit) return q.limit(c.n);
    return q;
  }, base);
}

export function serverTimestamp() { return FieldValue.serverTimestamp(); }
export function deleteField() { return FieldValue.delete(); }
