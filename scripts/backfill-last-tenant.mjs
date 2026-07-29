// Preenche users.lastTenantId em contas antigas, a partir do vínculo em members.
// Sem esse campo, a sessão depende do que sobrou no navegador: um dono de bolão
// que abrisse o link de outro bolão entrava lá como participante comum e perdia
// o acesso ao painel do próprio.
//
// Uso: node scripts/backfill-last-tenant.mjs [--commit]
import fs from 'fs';
import admin from 'firebase-admin';

const COMMIT = process.argv.includes('--commit');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'))) });
const db = admin.firestore();

// Dono tem prioridade sobre participante: é o bolão que ele administra.
const vinculos = {};
for (const t of (await db.collection('tenants').get()).docs) {
  for (const m of (await t.ref.collection('members').get()).docs) {
    const atual = vinculos[m.id];
    if (!atual || (m.data().role === 'owner' && atual.role !== 'owner')) {
      vinculos[m.id] = { tenantId: t.id, role: m.data().role };
    }
  }
}

let n = 0;
for (const d of (await db.collection('users').get()).docs) {
  const v = vinculos[d.id];
  if (!v) continue;
  if (d.data().lastTenantId === v.tenantId) continue;
  n++;
  console.log(`  ${d.data().name || d.id}: lastTenantId -> ${v.tenantId} (${v.role})`);
  if (COMMIT) await d.ref.update({ lastTenantId: v.tenantId });
}
console.log(`\n${COMMIT ? 'GRAVADO' : 'SIMULACAO'}: ${n} usuario(s).`);
process.exit(0);
