// Funções utilitárias puras (sem estado/React), compartilhadas pelo App.

export const generateCartelaCode = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `CART-${timestamp}-${random}`;
};

// Moeda BRL
export const fmtBRL = (n) => {
  try { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n)); }
  catch { return `R$ ${Number(n).toFixed(2)}`; }
};

export const sortMatchesByDate = (a, b) => {
  if (!a.date && !b.date) return 0;
  if (!a.date) return 1;
  if (!b.date) return -1;
  return new Date(a.date) - new Date(b.date);
};

// Encerramento efetivo do jogo: flag manual OU status terminal da API OU fallback por tempo
// (170 min cobre 90 reg + prorrogação completa + pênaltis + margem).
export const MATCH_FINISH_AFTER_MS = 170 * 60 * 1000;
// Status em andamento (API-Football short codes) — sincronizado com bolao-engine e footballApi.js
export const MATCH_IN_PROGRESS_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'INT', 'LIVE']);
export const isMatchEffectivelyFinished = (match) => {
  if (match?.finished) return true;
  if (match?.homeScore == null || match?.awayScore == null) return false;
  if (!match?.date) return false;
  if (match?.matchStatus && MATCH_IN_PROGRESS_STATUSES.has(match.matchStatus)) return false;
  return Date.now() - new Date(match.date).getTime() >= MATCH_FINISH_AFTER_MS;
};

export const getSafeLogo = (team) => {
  const url = team?.logo;
  if (url && typeof url === 'string' && url.startsWith('http')) return url;
  const name = team?.name || 'Time';
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=ffffff&color=0f172a&size=256`;
};

// Markdown mínimo → HTML (negrito, itálico, listas). Escapa HTML de entrada.
export const markdownToHtml = (md) => {
  if (!md) return '';
  const escapeHtml = (s) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const lines = md.split('\n');
  let html = '';
  let inUl = false;
  let inOl = false;
  const inline = (text) =>
    escapeHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>');
  for (const raw of lines) {
    const line = raw.trimRight();
    if (/^\s*-\s+/.test(line)) {
      if (!inUl) { html += '<ul>'; inUl = true; }
      html += `<li>${inline(line.replace(/^\s*-\s+/, ''))}</li>`;
      continue;
    } else if (inUl) { html += '</ul>'; inUl = false; }
    if (/^\s*\d+\.\s+/.test(line)) {
      if (!inOl) { html += '<ol>'; inOl = true; }
      html += `<li>${inline(line.replace(/^\s*\d+\.\s+/, ''))}</li>`;
      continue;
    } else if (inOl) { html += '</ol>'; inOl = false; }
    html += `<p>${inline(line)}</p>`;
  }
  if (inUl) html += '</ul>';
  if (inOl) html += '</ol>';
  return html;
};
