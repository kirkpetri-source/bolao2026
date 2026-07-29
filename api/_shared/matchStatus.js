// Situação de um jogo dentro da rodada. Módulo sem dependências: o painel, o
// app do participante e os crons precisam concordar sobre o que é um jogo
// adiado, senão a tela mostra uma coisa e a apuração faz outra.

// A fonte usa CÓDIGOS, não texto: na rodada 21 do Brasileirão ela devolveu
// "PST" para quatro jogos adiados. Procurar só por "postponed" ou "PPD" não
// pegava nada, e os jogos seguiam aparecendo como se fossem acontecer.
const CODIGOS_ADIADO = new Set(['PST', 'PPD', 'CANC', 'CNC', 'ABD', 'SUSP', 'INT', 'TBD', 'POST']);
const PADRAO_ADIADO = /postpon|adiad|cancel|abandon|suspend|adiam/i;

export function isMatchPostponed(match) {
  if (!match) return false;
  if (match.postponed === true) return true;
  // A fonte também tem um campo próprio, que nem sempre concorda com o status:
  // na rodada 21 ele vinha "no" enquanto o status já era "PST". Basta um dos
  // dois acusar para o jogo sair da rodada.
  if (String(match.strPostponed || '').toLowerCase() === 'yes') return true;

  const bruto = String(match.apiStatus ?? match.status ?? '').trim();
  if (!bruto) return false;
  if (CODIGOS_ADIADO.has(bruto.toUpperCase())) return true;
  return PADRAO_ADIADO.test(bruto);
}

// Vale pontos? Jogo adiado NÃO vale — e não vale para ninguém, o que mantém a
// rodada justa: quem palpitou nele não perde nem ganha em relação aos outros.
export function matchCountsForScoring(match) {
  return !isMatchPostponed(match)
    && match?.homeScore != null
    && match?.awayScore != null;
}

// Já podemos parar de esperar por este jogo? Sem isso a rodada exigia placar de
// um jogo adiado, que nunca chega, e ficava "em andamento" para sempre.
export function isMatchSettled(match, agora = Date.now()) {
  if (isMatchPostponed(match)) return true;
  if (match?.finished) return true;
  if (match?.homeScore == null || match?.awayScore == null) return false;
  if (!match?.date) return false;
  return agora - new Date(match.date).getTime() >= 170 * 60 * 1000;
}

// Quantos jogos da rodada realmente valem. Serve para a tela dizer "16 de 20
// jogos valendo" em vez de deixar o organizador contar na mão.
export function resumoDaRodada(matches = []) {
  const adiados = matches.filter(isMatchPostponed);
  return {
    total: matches.length,
    adiados: adiados.length,
    valendo: matches.length - adiados.length,
    nomesAdiados: adiados.map(m => `${m.homeTeamName} x ${m.awayTeamName}`),
  };
}
