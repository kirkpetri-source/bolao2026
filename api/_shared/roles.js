// Papéis do sistema, num lugar só.
//
// Existe porque a checagem estava copiada em cada endpoint lendo `isAdmin`, e
// quando o papel foi dividido em "opera a plataforma" x "dona de um bolão" as
// cópias ficaram para trás: o console respondia "Restrito ao administrador da
// plataforma" para a própria conta da plataforma.

// Opera o SaaS. A claim vale sem ler o Firestore; o campo no doc é o espelho
// dela, para o caso de o token ainda não ter sido renovado.
export async function isPlatformAdmin(db, decodedToken) {
  if (decodedToken?.platformAdmin === true) return true;
  const snap = await db.collection('users').doc(decodedToken.uid).get();
  return snap.exists && snap.data().platformAdmin === true;
}

// Dona de um bolão específico.
export async function isTenantOwner(db, uid, tenantId) {
  if (!tenantId) return false;
  const m = await db.collection('tenants').doc(tenantId).collection('members').doc(uid).get();
  return m.exists && m.data().role === 'owner';
}
