// Copia para cada doc de membro os campos que o painel precisa (nome, whatsapp,
// e-mail, estabelecimento). Sem isso a lista de participantes só existe na
// coleção GLOBAL /users, que mistura gente de todos os bolões — foi de lá que
// veio o vazamento entre clientes.
//
// Uso:  node scripts/backfill-members.mjs           (simula)
//       node scripts/backfill-members.mjs --commit  (grava)
import fs from 'fs';
import admin from 'firebase-admin';

const COMMIT = process.argv.includes('--commit');
const chave = JSON.parse(fs.readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(chave) });
const db = admin.firestore();

const usuarios = {};
(await db.collection('users').get()).docs.forEach(d => { usuarios[d.id] = d.data(); });

let alterados = 0, semUsuario = 0;
for (const tenant of (await db.collection('tenants').get()).docs) {
  const membros = await tenant.ref.collection('members').get();
  for (const m of membros.docs) {
    const u = usuarios[m.id];
    if (!u) { semUsuario++; console.log(`  ${tenant.id}/${m.id}: sem doc em /users (ignorado)`); continue; }

    const atual = m.data();
    const desejado = {
      name: u.name ?? atual.name ?? '',
      whatsapp: u.whatsapp ?? '',
      email: u.email ?? '',
      establishmentId: u.establishmentId ?? null,
    };
    const mudou = Object.entries(desejado).some(([k, v]) => atual[k] !== v);
    if (!mudou) continue;

    alterados++;
    console.log(`  ${tenant.id}/${m.id} (${desejado.name}) -> atualizar ${Object.keys(desejado).join(', ')}`);
    if (COMMIT) await m.ref.update(desejado);
  }
}

console.log(`\n${COMMIT ? 'GRAVADO' : 'SIMULACAO'}: ${alterados} membro(s) a atualizar, ${semUsuario} sem usuario.`);
if (!COMMIT) console.log('Rode com --commit para aplicar.');
process.exit(0);
