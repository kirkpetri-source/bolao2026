/**
 * Backup completo do Firestore para um arquivo JSON local (fora do banco).
 * Funciona no plano gratuito (não usa Storage/GCS). Roda com a service account.
 *
 * USO: node scripts/backup-firestore.mjs
 * Gera: backups/firestore-backup-<timestamp>.json  (pasta no .gitignore)
 *
 * Para restaurar, use os dados do JSON (cada chave é uma coleção; cada item tem id + campos).
 */
import { getAdminDb } from '../api/_shared/firebaseAdmin.js';
import { mkdirSync, writeFileSync } from 'node:fs';

const db = getAdminDb();
const cols = await db.listCollections();
const dump = {};
let totalDocs = 0;

for (const col of cols) {
  const snap = await col.get();
  dump[col.id] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  totalDocs += snap.size;
  console.log(`  ${col.id}: ${snap.size} docs`);
}

// Timestamps do Admin SDK viram { _seconds, _nanoseconds } no JSON — restauráveis.
const payload = { exportedAt: new Date().toISOString(), project: 'bolao-brasileirao-dev-kd', collections: Object.keys(dump).length, totalDocs, data: dump };

mkdirSync('backups', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const file = `backups/firestore-backup-${stamp}.json`;
writeFileSync(file, JSON.stringify(payload, null, 2));
console.log(`\nBackup salvo: ${file} (${Object.keys(dump).length} coleções, ${totalDocs} docs)`);
process.exit(0);
