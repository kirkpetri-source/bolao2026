// Regra de entrada em rodada para bolão que acabou de ser desbloqueado.
//
// O corte normal de palpite é o closeAt, 5 minutos antes do primeiro jogo. Isso
// serve para quem já estava jogando. Mas um bolão que passou o período
// bloqueado e é reativado em cima da hora entraria numa rodada prestes a
// começar: o organizador não teria tempo de avisar ninguém, e quem palpitasse
// nos minutos finais estaria decidindo com mais informação do que teve quem
// apostou dias antes. Nesse caso a rodada é pulada e ele começa na seguinte.

export const ANTECEDENCIA_MINIMA_MS = 2 * 60 * 60 * 1000; // 2 horas

function primeiroJogoEm(round) {
  const datas = (round.matches || []).map(m => m.date).filter(Boolean)
    .map(d => new Date(d).getTime()).filter(t => Number.isFinite(t));
  return datas.length ? Math.min(...datas) : null;
}

// Separa as rodadas abertas entre as que o bolão reativado ainda alcança e as
// que começam cedo demais. `rodadas` são objetos com { id, status, matches }.
export function separarPorAntecedencia(rodadas, agora = Date.now()) {
  const alcanca = [];
  const tardeDemais = [];

  for (const r of rodadas || []) {
    if (r.status !== 'open' && r.status !== 'upcoming') continue;
    const inicio = primeiroJogoEm(r);
    if (inicio === null) continue;
    if (inicio <= agora) continue;                     // já começou: nem entra na conta
    if (inicio - agora < ANTECEDENCIA_MINIMA_MS) tardeDemais.push(r);
    else alcanca.push(r);
  }

  const porNumero = (a, b) => (a.number || 0) - (b.number || 0);
  alcanca.sort(porNumero);
  tardeDemais.sort(porNumero);
  return { alcanca, tardeDemais };
}

// Frase para o organizador. Só existe quando alguma rodada foi pulada — dizer
// "você entrou na rodada X" quando nada foi pulado seria ruído.
export function mensagemDeEntrada({ alcanca, tardeDemais }) {
  if (!tardeDemais.length) return '';
  const puladas = tardeDemais.map(r => r.number).join(', ');
  const proxima = alcanca[0]?.number;
  const inicio = `A rodada ${puladas} começa em menos de 2 horas, então os palpites do seu bolão valem `;
  return proxima
    ? `${inicio}a partir da rodada ${proxima}.`
    : `${inicio}a partir da próxima rodada.`;
}
