import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || "AIzaSyCDEbEF3wQQck2bbIZfW1tCNROJzJ39cXQ",
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || "bolao-brasileirao-dev-kd.firebaseapp.com",
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || "bolao-brasileirao-dev-kd",
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || "bolao-brasileirao-dev-kd.firebasestorage.app",
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "1084218540237",
  appId: process.env.VITE_FIREBASE_APP_ID || "1:1084218540237:web:3e9b1d8d194a2e93472984"
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const db = getFirestore(app);

export function formatPhone(phone) {
  let p = String(phone || '').replace(/\D/g, '');
  if (p && !p.startsWith('55')) p = '55' + p;
  return p;
}

export async function getSettings() {
  const { getDocs, collection } = await import('firebase/firestore');
  const snap = await getDocs(collection(db, 'settings'));
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
