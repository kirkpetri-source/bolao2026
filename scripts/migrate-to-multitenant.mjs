/**
 * Migração para multi-tenant (Fase 2 do SaaS).
 *
 * MODELO:
 *  - Coleção nova `tenants/{tenantId}`: 1 doc por organizador (nome, dono, plano).
 *  - Campo `tenantId` adicionado em: rounds, predictions, establishments,
 *    communications, settings, public_config.
 *  - Coleção nova `memberships/{autoId}`: liga user ↔ tenant ↔ papel
 *    (owner p/ admin atual, participant p/ demais). Um user pode ter vários.
 *  - `users` e `teams` continuam globais (identidade e times compartilhados).
 *  - Os dados atuais viram o TENANT PADRÃO (o bolão do Kirk).
 *
 * SEGURO: por padrão roda em DRY-RUN (não grava nada, só mostra o plano).
 * Para aplicar de verdade: node scripts/migrate-to-multitenant.mjs --commit
 */
import { getAdminDb, getAdminAuth, FieldValue } from '../api/_shared/firebaseAdmin.js';

const COMMIT = process.argv.includes('--commit');
const TENANT_ID = 'bolao-lion-tech';           // slug do tenant padrão
const TENANT_NAME = 'Bolão Lion Tech';
const SCOPED = ['rounds', 'predictions', 'establishments', 'communications', 'settings', 'public_config'];

const db = getAdminDb();

async function main() {
  console.log(`=== Migração multi-tenant ${COMMIT ? '[COMMIT]' : '[DRY-RUN]'} ===`);
  console.log(`Tenant padrão: ${TENANT_ID} (${TENANT_NAME})\n`);

  // 1) Doc do tenant
  const tenantRef = db.collection('tenants').doc(TENANT_ID);
  const tenantSnap = await tenantRef.get();
  const usersSnap = await db.collection('users').get();
  const owner = usersSnap.docs.find(d => d.data().isAdmin === true);
  console.log(`tenants/${TENANT_ID}: ${tenantSnap.exists ? 'já existe' : 'será criado'} (dono: ${owner ? owner.data().name : 'nenhum admin encontrado'})`);
  if (COMMIT && !tenantSnap.exists) {
    await tenantRef.set({
      name: TENANT_NAME,
      ownerId: owner ? owner.id : null,
      plan: 'ativo',
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  // 2) tenantId nas coleções escopadas
  for (const col of SCOPED) {
    const snap = await db.collection(col).get();
    const semTenant = snap.docs.filter(d => !d.data().tenantId);
    console.log(`${col}: ${snap.size} docs, ${semTenant.length} sem tenantId ${COMMIT ? '→ atualizando' : '(seriam atualizados)'}`);
    if (COMMIT) {
      let batch = db.batch(); let n = 0;
      for (const d of semTenant) {
        batch.update(d.ref, { tenantId: TENANT_ID });
        if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
      }
      if (n % 400 !== 0) await batch.commit();
    }
  }

  // 3) memberships para cada usuário
  const memColl = db.collection('memberships');
  const existingMem = await memColl.where('tenantId', '==', TENANT_ID).get();
  const jaTem = new Set(existingMem.docs.map(d => d.data().userId));
  let owners = 0, parts = 0, criados = 0;
  for (const u of usersSnap.docs) {
    if (jaTem.has(u.id)) continue;
    const role = u.data().isAdmin === true ? 'owner' : 'participant';
    if (role === 'owner') owners++; else parts++;
    if (COMMIT) { await memColl.add({ tenantId: TENANT_ID, userId: u.id, role, createdAt: FieldValue.serverTimestamp() }); criados++; }
  }
  console.log(`memberships: ${owners} owner(s) + ${parts} participante(s) ${COMMIT ? `→ ${criados} criados` : '(seriam criados)'}`);

  console.log(`\n${COMMIT ? 'Migração aplicada.' : 'DRY-RUN concluído. Nada foi gravado. Rode com --commit para aplicar.'}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
