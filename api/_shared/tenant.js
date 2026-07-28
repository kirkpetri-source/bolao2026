// Multi-tenant no backend (Fase 3 do SaaS).
// Os crons iteram todos os tenants; endpoints de plataforma (reset de senha,
// Woovi por enquanto) usam o tenant padrão. Mantém em sincronia com src/tenant.js.
import { getAdminDb } from './firebaseAdmin.js';

export const DEFAULT_TENANT_ID = 'bolao-lion-tech';

// Todos os tenants (bolões) cadastrados.
export async function listTenants() {
  const snap = await getAdminDb().collection('tenants').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Mapa uid → dados de /users (identidade global), para joins com members.
export async function getUsersById() {
  const snap = await getAdminDb().collection('users').get();
  const byId = {};
  snap.docs.forEach(d => { byId[d.id] = { id: d.id, ...d.data() }; });
  return byId;
}

// Participantes de um tenant (members role 'participant' + dados de /users).
export async function getTenantParticipants(tenantId, usersById) {
  const users = usersById || await getUsersById();
  const memSnap = await getAdminDb()
    .collection('tenants').doc(tenantId).collection('members').get();
  return memSnap.docs
    .filter(m => m.data().role === 'participant')
    .map(m => ({ id: m.id, role: 'participant', name: m.data().name || '', ...(users[m.id] || {}) }));
}
