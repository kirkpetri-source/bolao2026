import axios from 'axios';

const SPORTSDB_BASE = 'https://www.thesportsdb.com/api/v1/json/123';
const SPORTSDB_LEAGUE = '4351';
const SPORTSDB_SEASON = '2026';

const APIFOOTBALL_BASE = 'https://v3.football.api-sports.io';
const APIFOOTBALL_LEAGUE = '71';

function normalizeName(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export async function getRoundFixtures(roundNumber) {
  const url = `${SPORTSDB_BASE}/eventsround.php?id=${SPORTSDB_LEAGUE}&r=${roundNumber}&s=${SPORTSDB_SEASON}`;
  const res = await axios.get(url, { timeout: 10000 });
  const events = res.data?.events || [];
  return events.map(e => ({
    apiEventId: String(e.idEvent),
    roundNumber: parseInt(e.intRound, 10),
    homeTeamName: e.strHomeTeam,
    homeTeamApiId: String(e.idHomeTeam),
    homeTeamLogo: e.strHomeTeamBadge || '',
    awayTeamName: e.strAwayTeam,
    awayTeamApiId: String(e.idAwayTeam),
    awayTeamLogo: e.strAwayTeamBadge || '',
    date: (() => {
      // TheSportsDB devolve timestamps em UTC mas sem indicador de fuso.
      // Normalizamos para +00:00 para que o JS interprete corretamente.
      const raw = e.strTimestamp || (e.dateEvent ? `${e.dateEvent}T${e.strTime || '00:00:00'}` : null);
      if (!raw) return null;
      const s = raw.trim().replace(' ', 'T').slice(0, 19); // "YYYY-MM-DDTHH:MM:SS"
      // Adiciona +00:00 apenas se não houver indicador de fuso
      return /[Zz]$|[+-]\d{2}:\d{2}$/.test(s) ? s : s + '+00:00';
    })(),
    homeScore: e.intHomeScore !== null && e.intHomeScore !== '' ? parseInt(e.intHomeScore, 10) : null,
    awayScore: e.intAwayScore !== null && e.intAwayScore !== '' ? parseInt(e.intAwayScore, 10) : null,
    finished: e.strStatus === 'Match Finished',
    status: e.strStatus || 'Not Started',
    homeTeamNormalized: normalizeName(e.strHomeTeam),
    awayTeamNormalized: normalizeName(e.strAwayTeam)
  }));
}

export async function getAllTeams() {
  // Extrai times únicos das primeiras 4 rodadas (cobrem todos os 20 times)
  const teamsMap = {};
  for (const roundNum of [1, 2, 3, 4]) {
    try {
      const fixtures = await getRoundFixtures(roundNum);
      for (const f of fixtures) {
        if (!teamsMap[f.homeTeamApiId]) {
          teamsMap[f.homeTeamApiId] = {
            apiTeamId: f.homeTeamApiId,
            name: f.homeTeamName,
            normalizedName: f.homeTeamNormalized,
            logo: f.homeTeamLogo
          };
        }
        if (!teamsMap[f.awayTeamApiId]) {
          teamsMap[f.awayTeamApiId] = {
            apiTeamId: f.awayTeamApiId,
            name: f.awayTeamName,
            normalizedName: f.awayTeamNormalized,
            logo: f.awayTeamLogo
          };
        }
      }
      await new Promise(r => setTimeout(r, 200));
    } catch {}
  }
  return Object.values(teamsMap);
}

// Status terminais oficiais da API-Football — jogo encerrado definitivamente
const TERMINAL_STATUSES = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);

// Status em andamento — jogo NÃO pode ser marcado como finalizado
const IN_PROGRESS_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'INT', 'LIVE']);

export { TERMINAL_STATUSES, IN_PROGRESS_STATUSES };

export async function getLiveScores(apiFootballKey) {
  const key = apiFootballKey || process.env.APIFOOTBALL_KEY;
  if (!key) return [];
  try {
    const res = await axios.get(`${APIFOOTBALL_BASE}/fixtures`, {
      params: { live: 'all', league: APIFOOTBALL_LEAGUE },
      headers: { 'x-apisports-key': key },
      timeout: 10000
    });
    return (res.data?.response || []).map(f => ({
      apiEventId: String(f.fixture.id),
      homeScore: f.goals.home,
      awayScore: f.goals.away,
      elapsed: f.fixture.status.elapsed,
      // matchStatus carrega o código curto (ex: 'FT', 'AET', 'ET', 'P') para uso downstream
      matchStatus: f.fixture.status.short,
      // finished=true apenas para status terminais definitivos (FT, AET, PEN, AWD, WO)
      finished: TERMINAL_STATUSES.has(f.fixture.status.short),
      status: f.fixture.status.long
    }));
  } catch {
    return [];
  }
}

export { normalizeName };
