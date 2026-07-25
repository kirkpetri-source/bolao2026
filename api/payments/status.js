import { db } from '../_shared/firebase.js';
import { doc, getDoc } from '../_shared/firestore.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }
    const { id } = req.query;
    if (!id) {
      res.status(400).json({ error: 'Missing transaction id' });
      return;
    }
    const snap = await getDoc(doc(db, 'transactions', id));
    if (!snap.exists()) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const data = snap.data();
    const safe = { ...data };
    delete safe.encryptedCpf;
    delete safe.encryptedPixKey;
    delete safe.encryptionIv;
    delete safe.encryptionTag;
    res.status(200).json({ id, ...safe });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
}
