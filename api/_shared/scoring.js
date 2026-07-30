// Pontuação de um palpite — regra única do sistema.
//
// Existiam TRÊS cópias desta regra e uma delas divergia: api/ranking/public.js
// (a página pública que o organizador manda no grupo) dava 10 pontos ao placar
// exato, 7 ao saldo e 5 a um placar certo, enquanto o app, o cron de placares e
// o motor da rodada davam 3 ao exato e 1 a quem só acertou o vencedor. Ou seja,
// a mesma cartela valia pontos diferentes — e a ORDEM do ranking público podia
// sair diferente da do painel, justamente na tela que decide prêmio.
//
// A regra verdadeira é a que está em uso desde o começo e é a que o
// participante vê no app: placar exato vale 3, acertar quem ganhou vale 1.
//
// Sem dependências de propósito: cron, endpoint e front importam o MESMO
// arquivo. Regra de pontuação copiada é regra que diverge.

export const PONTOS_PLACAR_EXATO = 3;
export const PONTOS_VENCEDOR = 1;

function ladoDoResultado(casa, fora) {
  if (casa > fora) return 'casa';
  if (casa < fora) return 'fora';
  return 'empate';
}

// Palpite sem placar real (jogo não terminou) não pontua.
export function calcPoints(palpiteCasa, palpiteFora, realCasa, realFora) {
  if (realCasa == null || realFora == null) return 0;
  if (palpiteCasa == null || palpiteFora == null) return 0;

  if (palpiteCasa === realCasa && palpiteFora === realFora) return PONTOS_PLACAR_EXATO;

  return ladoDoResultado(palpiteCasa, palpiteFora) === ladoDoResultado(realCasa, realFora)
    ? PONTOS_VENCEDOR
    : 0;
}

// Texto curto do que a pessoa acertou — usado na demonstração da página de venda
// e disponível para telas que queiram explicar o ponto.
export function explicaPontos(palpiteCasa, palpiteFora, realCasa, realFora) {
  const pts = calcPoints(palpiteCasa, palpiteFora, realCasa, realFora);
  if (pts === PONTOS_PLACAR_EXATO) return 'Placar exato';
  if (pts === PONTOS_VENCEDOR) {
    return ladoDoResultado(realCasa, realFora) === 'empate'
      ? 'Acertou o empate'
      : 'Acertou quem ganhou';
  }
  return 'Errou o resultado';
}
