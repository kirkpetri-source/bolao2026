import axios from 'axios';

export const FALLBACK_TEAMS = [
  { name: 'Palmeiras', logo: 'https://logodetimes.com/times/palmeiras/logo-palmeiras-256.png' },
  { name: 'Flamengo', logo: 'https://logodetimes.com/times/flamengo/logo-flamengo-256.png' },
  { name: 'Cruzeiro', logo: 'https://logodetimes.com/times/cruzeiro/logo-cruzeiro-256.png' },
  { name: 'Mirassol', logo: 'https://logodetimes.com/times/mirassol/logo-mirassol-256.png' },
  { name: 'Botafogo', logo: 'https://logodetimes.com/times/botafogo/logo-botafogo-256.png' },
  { name: 'Bahia', logo: 'https://logodetimes.com/times/bahia/logo-bahia-256.png' },
  { name: 'Fluminense', logo: 'https://logodetimes.com/times/fluminense/logo-fluminense-256.png' },
  { name: 'São Paulo', logo: 'https://logodetimes.com/times/sao-paulo/logo-sao-paulo-256.png' },
  { name: 'Red Bull Bragantino', logo: 'https://logodetimes.com/times/bragantino/logo-bragantino-256.png' },
  { name: 'Ceará', logo: 'https://logodetimes.com/times/ceara/logo-ceara-256.png' },
  { name: 'Vasco da Gama', logo: 'https://logodetimes.com/times/vasco/logo-vasco-256.png' },
  { name: 'Corinthians', logo: 'https://logodetimes.com/times/corinthians/logo-corinthians-256.png' },
  { name: 'Grêmio', logo: 'https://logodetimes.com/times/gremio/logo-gremio-256.png' },
  { name: 'Atlético Mineiro', logo: 'https://logodetimes.com/times/atletico-mineiro/logo-atletico-mineiro-256.png' },
  { name: 'Internacional', logo: 'https://logodetimes.com/times/internacional/logo-internacional-256.png' },
  { name: 'Santos', logo: 'https://logodetimes.com/times/santos/logo-santos-256.png' },
  { name: 'Vitória', logo: 'https://logodetimes.com/times/vitoria/logo-vitoria-256.png' },
  { name: 'Fortaleza', logo: 'https://logodetimes.com/times/fortaleza/logo-fortaleza-256.png' },
  { name: 'Juventude', logo: 'https://logodetimes.com/times/juventude/logo-juventude-256.png' },
  { name: 'Sport', logo: 'https://logodetimes.com/times/sport/logo-sport-256.png' }
];

export const normalizeName = (s) => s?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export const mapApiTeamsToPayload = (teams) => {
  const safe = Array.isArray(teams) ? teams : [];
  return safe.map(t => {
    const name = t.name || t.nome || 'Time';
    const logo = t.logo || t.shield || '';
    return { name, logo, normalizedName: normalizeName(name) };
  });
};

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    const apiUrl = process.env.BRASILEIRAO_API_URL;
    let teams = FALLBACK_TEAMS;
    if (apiUrl) {
      try {
        const r = await axios.get(apiUrl, { timeout: 10000 });
        const data = Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.teams) ? r.data.teams : []);
        if (data.length) teams = data;
      } catch (err) {
        // Se API falhar, devolve fallback; não cria nada no DB
      }
    }

    const payload = mapApiTeamsToPayload(teams);
    res.status(200).json({ ok: true, source: apiUrl ? 'external' : 'fallback', teams: payload });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err?.message || String(err) });
  }
}