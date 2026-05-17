// Vercel Serverless Function to proxy EvolutionAPI sendText (ESM)
// Notes:
// - Reads link, instance, token from request body (as currently configured on the client)
// - Sanitizes URL parts and posts to EvolutionAPI
// - Uses https.Agent with rejectUnauthorized: false to tolerate self-signed/invalid certs
//   This is a temporary workaround. Prefer fixing TLS with a valid certificate.

import https from 'https';
import axios from 'axios';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { number, text, link, instance, token } = req.body || {};
    if (!number || !text) {
      res.status(400).json({ error: 'Missing required fields: number, text' });
      return;
    }
    if (!link || !instance || !token) {
      res.status(400).json({ error: 'EvolutionAPI not configured: link, instance, token required' });
      return;
    }

    // Sanitize and build URL
    let base = String(link || '').trim().replace(/\/$/, '').replace(/\.$/, '');
    let inst = String(instance || '').trim().replace(/\.$/, '');

    const allowHttp = process.env.EVOLUTION_ALLOW_HTTP_UPSTREAM === 'true';
    const isHttps = base.startsWith('https://');
    const isHttp = base.startsWith('http://');

    // If protocol not provided, default based on flag
    if (!isHttps && !isHttp) {
      base = (allowHttp ? 'http://' : 'https://') + base;
    }
    // If HTTP requested but not allowed, block explicitly (keeps prod safe by default)
    if (base.startsWith('http://') && !allowHttp) {
      res.status(400).json({ error: 'HTTP upstream disabled', detail: 'Enable EVOLUTION_ALLOW_HTTP_UPSTREAM=true to allow http upstream links' });
      return;
    }

    const url = `${base}/message/sendText/${encodeURIComponent(inst)}`;

    // rejectUnauthorized is false by default (workaround for self-signed EvolutionAPI certs).
    // Set EVOLUTION_VERIFY_TLS=true in env to enforce strict TLS validation.
    const verifyTls = process.env.EVOLUTION_VERIFY_TLS === 'true';
    const agent = base.startsWith('https://') ? new https.Agent({ rejectUnauthorized: verifyTls }) : undefined;

    const MAX_ATTEMPTS = 3;
    const SLEEP_MS = 600;
    let lastErr = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await axios.post(
          url,
          { number, text },
          {
            headers: { 'Content-Type': 'application/json', apikey: token },
            httpsAgent: agent,
            timeout: 15000,
          }
        );
        return res.status(200).json(response.data || { ok: true, attempt });
      } catch (err) {
        lastErr = err;
        const status = err?.response?.status;
        const code = err?.code;
        const retriable = status === 502 || status === 503 || status === 504 || ['ECONNRESET','ENOTFOUND','ECONNREFUSED','ETIMEDOUT'].includes(code);
        if (attempt < MAX_ATTEMPTS && retriable) {
          await new Promise(r => setTimeout(r, SLEEP_MS));
          continue;
        }
        break;
      }
    }
    const msg = lastErr?.response?.data || lastErr?.message || 'request failed';
    res.status(502).json({ error: 'EvolutionAPI request failed', detail: msg });
  } catch (err) {
    const msg = err?.response?.data || err?.message || 'request failed';
    res.status(502).json({ error: 'EvolutionAPI request failed', detail: msg });
  }
}