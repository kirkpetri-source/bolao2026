import { describe, it, expect } from 'vitest';
import { separarPorAntecedencia, mensagemDeEntrada, ANTECEDENCIA_MINIMA_MS } from '../api/_shared/roundsAccess.js';

const HORA = 36e5;
const AGORA = Date.UTC(2026, 6, 29, 12, 0, 0);
const em = (h) => new Date(AGORA + h * HORA).toISOString();

const rodada = (number, horasAteOJogo, over = {}) => ({
  id: `r${number}`, number, status: 'open',
  matches: [{ id: 1, date: em(horasAteOJogo) }, { id: 2, date: em(horasAteOJogo + 2) }],
  ...over,
});

describe('entrada em rodada apos desbloqueio', () => {
  it('o limite e de 2 horas', () => {
    expect(ANTECEDENCIA_MINIMA_MS).toBe(2 * HORA);
  });

  it('alcanca rodada que comeca com folga', () => {
    const { alcanca, tardeDemais } = separarPorAntecedencia([rodada(21, 5)], AGORA);
    expect(alcanca.map(r => r.number)).toEqual([21]);
    expect(tardeDemais).toEqual([]);
  });

  it('NAO alcanca rodada que comeca em menos de 2 horas', () => {
    const { alcanca, tardeDemais } = separarPorAntecedencia([rodada(21, 1.5)], AGORA);
    expect(alcanca).toEqual([]);
    expect(tardeDemais.map(r => r.number)).toEqual([21]);
  });

  it('exatamente 2 horas ainda alcanca', () => {
    // O limite e "menos de 2 horas": em cima da marca o organizador entra.
    const { alcanca } = separarPorAntecedencia([rodada(21, 2)], AGORA);
    expect(alcanca.map(r => r.number)).toEqual([21]);
  });

  it('ignora rodada que ja comecou', () => {
    const { alcanca, tardeDemais } = separarPorAntecedencia([rodada(20, -3)], AGORA);
    expect(alcanca).toEqual([]);
    expect(tardeDemais).toEqual([]);
  });

  it('ignora rodada ja encerrada', () => {
    const { alcanca } = separarPorAntecedencia([rodada(19, 5, { status: 'finished' })], AGORA);
    expect(alcanca).toEqual([]);
  });

  it('pula a de cima da hora e aponta a seguinte', () => {
    const lista = [rodada(21, 1), rodada(22, 8 * 24)];
    const sep = separarPorAntecedencia(lista, AGORA);
    expect(sep.tardeDemais.map(r => r.number)).toEqual([21]);
    expect(sep.alcanca.map(r => r.number)).toEqual([22]);
    expect(mensagemDeEntrada(sep)).toContain('rodada 21 começa em menos de 2 horas');
    expect(mensagemDeEntrada(sep)).toContain('a partir da rodada 22');
  });

  it('nao inventa aviso quando nada foi pulado', () => {
    const sep = separarPorAntecedencia([rodada(21, 30)], AGORA);
    expect(mensagemDeEntrada(sep)).toBe('');
  });

  it('avisa mesmo sem proxima rodada conhecida', () => {
    const sep = separarPorAntecedencia([rodada(38, 1)], AGORA);
    expect(mensagemDeEntrada(sep)).toContain('a partir da próxima rodada');
  });

  it('ignora rodada sem data de jogo', () => {
    const sep = separarPorAntecedencia([{ id: 'x', number: 21, status: 'open', matches: [{ id: 1 }] }], AGORA);
    expect(sep.alcanca).toEqual([]);
    expect(sep.tardeDemais).toEqual([]);
  });
});
