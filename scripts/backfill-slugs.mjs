// Grava `slug` e `slugPlano` no public_config dos bolões existentes.
// slugPlano é o endereço sem hífen: quem digita de cabeça escreve
// "bolaododeryck", não "bolao-do-deryck".
//
// Uso: node scripts/backfill-slugs.mjs [--commit]
import fs from 'fs';
import admin from 'firebase-admin';

const COMMIT = process.argv.includes('--commit');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'))) });
const db = admin.firestore();

let n = 0;
for (const d of (await db.collection('public_config').get()).docs) {
  const dados = d.data();
  const slug = dados.tenantId || d.id;
  const slugPlano = slug.replace(/-/g, '');
  if (dados.slug === slug && dados.slugPlano === slugPlano) continue;
  n++;
  console.log(`  ${d.id}: slug=${slug} slugPlano=${slugPlano}`);
  if (COMMIT) await d.ref.set({ slug, slugPlano }, { merge: true });
}
console.log(`\n${COMMIT ? 'GRAVADO' : 'SIMULACAO'}: ${n} config(s).`);
process.exit(0);
