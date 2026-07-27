// Backup diário do Firestore para o Cloud Storage (bucket com retenção de 30 dias).
// Exporta todas as coleções para um JSON. Protegido por CRON_SECRET.
import { getAdminDb, getAdminStorage } from '../_shared/firebaseAdmin.js';

const BUCKET = process.env.BACKUP_BUCKET || 'bolao-brasileirao-dev-kd-backups';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getAdminDb();
    const cols = await db.listCollections();
    const dump = {};
    let totalDocs = 0;
    for (const col of cols) {
      const snap = await col.get();
      dump[col.id] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      totalDocs += snap.size;
    }
    const payload = JSON.stringify({
      exportedAt: new Date().toISOString(),
      project: 'bolao-brasileirao-dev-kd',
      collections: Object.keys(dump).length,
      totalDocs,
      data: dump,
    });

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');
    const fileName = `backups/firestore-${stamp}.json`;
    await getAdminStorage().bucket(BUCKET).file(fileName).save(payload, {
      contentType: 'application/json',
      resumable: false,
    });

    return res.status(200).json({ ok: true, file: fileName, collections: Object.keys(dump).length, totalDocs });
  } catch (err) {
    console.error('backup error:', err.message);
    return res.status(500).json({ error: err.message || 'Erro ao gerar backup' });
  }
}
