import { describe, it, expect } from 'vitest';
import {
  calcPoints, explicaPontos, PONTOS_PLACAR_EXATO, PONTOS_VENCEDOR,
} from '../api/_shared/scoring.js';

describe('pontuação de um palpite', () => {
  it('placar exato vale 3', () => {
    expect(calcPoints(2, 1, 2, 1)).toBe(3);
    expect(PONTOS_PLACAR_EXATO).toBe(3);
  });

  it('acertar quem ganhou vale 1', () => {
    expect(calcPoints(3, 0, 2, 1)).toBe(1);   // vitória da casa
    expect(calcPoints(0, 3, 1, 2)).toBe(1);   // vitória do visitante
    expect(PONTOS_VENCEDOR).toBe(1);
  });

  it('empate com placar diferente vale 1', () => {
    expect(calcPoints(1, 1, 2, 2)).toBe(1);
  });

  it('errar o resultado não pontua', () => {
    expect(calcPoints(2, 1, 1, 2)).toBe(0);
    expect(calcPoints(1, 1, 2, 0)).toBe(0);
    expect(calcPoints(2, 0, 1, 1)).toBe(0);
  });

  it('jogo sem placar não pontua', () => {
    expect(calcPoints(1, 0, null, null)).toBe(0);
    expect(calcPoints(1, 0, undefined, 2)).toBe(0);
  });

  it('palpite ausente não pontua', () => {
    expect(calcPoints(null, null, 2, 1)).toBe(0);
  });

  // A regressão que criou o módulo: a página pública de resultado usava outra
  // escala (10/7/5/3), então a mesma cartela valia pontos diferentes e o
  // ranking podia sair em ordem diferente da do painel.
  it('não usa a escala antiga da página pública', () => {
    expect(calcPoints(2, 1, 2, 1)).not.toBe(10);
    expect(calcPoints(3, 2, 2, 1)).not.toBe(7);   // mesmo saldo, placar errado
    expect(calcPoints(2, 0, 2, 1)).not.toBe(5);   // um placar certo
  });

  it('a ordem do ranking segue a regra única', () => {
    const real = [2, 1];
    const cartelas = [
      { nome: 'exato', palpite: [2, 1] },
      { nome: 'vencedor', palpite: [4, 0] },
      { nome: 'errou', palpite: [0, 2] },
    ].map(c => ({ ...c, pts: calcPoints(c.palpite[0], c.palpite[1], real[0], real[1]) }));

    expect(cartelas.sort((a, b) => b.pts - a.pts).map(c => c.nome))
      .toEqual(['exato', 'vencedor', 'errou']);
  });
});

describe('explicação do ponto', () => {
  it('diz o que a pessoa acertou', () => {
    expect(explicaPontos(2, 1, 2, 1)).toBe('Placar exato');
    expect(explicaPontos(3, 0, 2, 1)).toBe('Acertou quem ganhou');
    expect(explicaPontos(1, 1, 2, 2)).toBe('Acertou o empate');
    expect(explicaPontos(0, 2, 2, 1)).toBe('Errou o resultado');
  });
});
