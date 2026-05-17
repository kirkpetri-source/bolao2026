import { getSettings, sendWhatsAppDocument } from '../_shared/firebase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { number, base64, fileName, caption } = req.body;
  if (!number || !base64) {
    return res.status(400).json({ error: 'Parâmetros obrigatórios: number, base64' });
  }

  try {
    const settings = await getSettings();
    const ok = await sendWhatsAppDocument(number, base64, fileName || 'documento.pdf', caption || '', settings);

    if (!ok) {
      return res.status(502).json({ error: 'Falha ao enviar documento via EvolutionAPI' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('sendDocument error:', err.message);
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
}
