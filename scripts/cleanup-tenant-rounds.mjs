/**
 * Remove rodadas passadas "fantasmas" de um bolão novo (criadas pelo sync antes
 * da correção que impede rodadas encerradas em tenants novos).
 *
 * Apaga SOMENTE rodadas com status 'closed' ou 'finished' do tenant informado,
 * e SOMENTE se o tenant não tiver nenhum palpite (proteção contra perda de dados).
 * Rodadas 'open' e 'upcoming' são preservadas.
 *
 * SEGURO: por padrão roda em DRY-RUN. Para aplicar:
 *   node scripts/cleanup-tenant-rounds.mjs <tenantId> --commit
 */
import { getAdminDb } from '../api/_shared/firebaseAdmin.js';

const tenantId = process.argv[2];
const COMMIT = process.argv.includes('--commit');
if (!tenantId || tenantId.startsWith('--')) {
  console.error('USO: node scripts/cleanup-tenant-rounds.mjs <tenantId> [--commit]');
  process.exit(1);
}

const db = getAdminDb();

const preds = await db.collection('predictions').where('tenantId', '==', tenantId).get();
if (preds.size > 0) {
  console.error(`ABORTADO: o tenant ${tenantId} tem ${preds.size} palpite(s). Este script é só para bolões sem apostas.`);
  process.exit(1);
}

const rounds = await db.collection('rounds').where('tenantId', '==', tenantId).get();
let del = 0;
const kept = [];
for (const d of rounds.docs) {
  const r = d.data();
  if (r.status === 'finished' || r.status === 'closed') {
    console.log(`R${r.number} (${r.status}) ${COMMIT ? '→ apagada' : '(seria apagada)'}`);
    if (COMMIT) await d.ref.delete();
    del++;
  } else {
    kept.push(`R${r.number} (${r.status})`);
  }
}
console.log(`\n${COMMIT ? 'Apagadas' : 'Seriam apagadas'}: ${del} | Mantidas: ${kept.sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1))).join(', ') || 'nenhuma'}`);
if (!COMMIT) console.log('DRY-RUN: nada foi gravado. Rode com --commit para aplicar.');
