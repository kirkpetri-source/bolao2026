import { db, getSettings } from '../_shared/firebase.js';
import { getAllTeams } from '../services/footballApi.js';
import { collection, getDocs, addDoc, updateDoc, doc, serverTimestamp, query, where } from '../_shared/firestore.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const logs = [];

  try {
    const apiTeams = await getAllTeams();
    if (!apiTeams.length) {
      return res.status(200).json({ success: true, logs: ['TheSportsDB retornou 0 times.'] });
    }

    const teamsSnap = await getDocs(collection(db, 'teams'));

    // Indexar por normalizedName E por nome normalizado calculado (cobre times sem normalizedName)
    const existingByNorm = {};
    const existingByApiId = {};
    for (const d of teamsSnap.docs) {
      const data = d.data();
      const entry = { id: d.id, ...data };
      // Garantir que todos os times tenham normalizedName salvo
      if (!data.normalizedName && data.name) {
        const norm = data.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
        await updateDoc(doc(db, 'teams', d.id), { normalizedName: norm });
        entry.normalizedName = norm;
      }
      if (entry.normalizedName) existingByNorm[entry.normalizedName] = entry;
      if (data.apiTeamId) existingByApiId[data.apiTeamId] = entry;
    }

    let created = 0, updated = 0;

    for (const apiTeam of apiTeams) {
      const norm = apiTeam.normalizedName;
      // Verificar por apiTeamId primeiro (mais preciso), depois por normalizedName
      const current = existingByApiId[apiTeam.apiTeamId] || existingByNorm[norm];

      if (current) {
        const needsUpdate = current.logo !== apiTeam.logo || current.apiTeamId !== apiTeam.apiTeamId || !current.normalizedName;
        if (needsUpdate) {
          await updateDoc(doc(db, 'teams', current.id), {
            logo: apiTeam.logo,
            apiTeamId: apiTeam.apiTeamId,
            normalizedName: norm,
            updatedAt: serverTimestamp()
          });
          updated++;
        }
      } else {
        await addDoc(collection(db, 'teams'), {
          name: apiTeam.name,
          normalizedName: norm,
          logo: apiTeam.logo,
          apiTeamId: apiTeam.apiTeamId,
          createdAt: serverTimestamp()
        });
        created++;
        logs.push(`Time criado: ${apiTeam.name}`);
      }
    }

    logs.push(`Times processados: ${apiTeams.length} da API | Criados: ${created} | Atualizados: ${updated}`);
    return res.status(200).json({ success: true, logs });
  } catch (err) {
    console.error('sync-teams error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
}
