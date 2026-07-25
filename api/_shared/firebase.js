// Backend usa Admin SDK (ignora as regras — servidor confiável).
// db é o Firestore do Admin SDK; getSettings lê a coleção 'settings' completa.
import { getAdminDb } from './firebaseAdmin.js';

export const db = getAdminDb();

export function formatPhone(phone) {
  let p = String(phone || '').replace(/\D/g, '');
  if (p && !p.startsWith('55')) p = '55' + p;
  return p;
}

export async function getSettings() {
  const snap = await db.collection('settings').get();
  return snap.empty ? {} : snap.docs[0].data();
}

export async function sendWhatsApp(number, text, settings) {
  const { default: axios } = await import('axios');
  const { default: https } = await import('https');

  const cfg = settings?.devolution || {};
  const link = cfg.link || process.env.EVOLUTION_LINK;
  const instance = cfg.instanceName || process.env.EVOLUTION_INSTANCE;
  const token = cfg.token || process.env.EVOLUTION_TOKEN;

  if (!link || !instance || !token) return false;

  const base = link.trim().replace(/\/$/, '');
  const url = `${base}/message/sendText/${encodeURIComponent(instance.trim())}`;
  const verifyTls = process.env.EVOLUTION_VERIFY_TLS === 'true';
  const agent = url.startsWith('https') ? new https.Agent({ rejectUnauthorized: verifyTls }) : undefined;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await axios.post(url, { number, text }, {
        headers: { 'Content-Type': 'application/json', apikey: token },
        httpsAgent: agent,
        timeout: 12000
      });
      return true;
    } catch (err) {
      const status = err.response?.status;
      if (attempt < 3 && [502, 503, 504].includes(status)) {
        await new Promise(r => setTimeout(r, 1500 * attempt));
        continue;
      }
      console.error('sendWhatsApp error:', err.response?.data || err.message);
      return false;
    }
  }
  return false;
}

export async function sendWhatsAppDocument(number, base64Pdf, fileName, caption, settings) {
  const { default: axios } = await import('axios');
  const { default: https } = await import('https');

  const cfg = settings?.devolution || {};
  const link = cfg.link || process.env.EVOLUTION_LINK;
  const instance = cfg.instanceName || process.env.EVOLUTION_INSTANCE;
  const token = cfg.token || process.env.EVOLUTION_TOKEN;

  if (!link || !instance || !token) return false;

  const base = link.trim().replace(/\/$/, '');
  const url = `${base}/message/sendMedia/${encodeURIComponent(instance.trim())}`;
  const verifyTls = process.env.EVOLUTION_VERIFY_TLS === 'true';
  const agent = url.startsWith('https') ? new https.Agent({ rejectUnauthorized: verifyTls }) : undefined;

  try {
    await axios.post(url, {
      number,
      mediatype: 'document',
      mimetype: 'application/pdf',
      caption: caption || '',
      media: base64Pdf,
      fileName: fileName || 'resultado.pdf'
    }, {
      headers: { 'Content-Type': 'application/json', apikey: token },
      httpsAgent: agent,
      timeout: 30000
    });
    return true;
  } catch (err) {
    console.error('sendWhatsAppDocument error:', err.response?.data || err.message);
    return false;
  }
}
