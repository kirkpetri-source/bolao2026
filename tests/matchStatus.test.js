import { describe, it, expect } from 'vitest';
import { isMatchPostponed, matchCountsForScoring, isMatchSettled, resumoDaRodada } from '../api/_shared/matchStatus.js';

const jogo = (o = {}) => ({ homeTeamName: 'A', awayTeamName: 'B', date: '2026-08-10T19:00:00+00:00', ...o });

describe('jogo adiado', () => {
  it('reconhece pela marca do sync', () => {
    expect(isMatchPostponed(jogo({ postponed: true }))).toBe(true);
  });

  it('reconhece pelo texto, para jogos gravados antes do campo existir', () => {
    expect(isMatchPostponed(jogo({ apiStatus: 'Match Postponed' }))).toBe(true);
    expect(isMatchPostponed(jogo({ status: 'Cancelled' }))).toBe(true);
  });

  // A fonte usa CODIGO, nao texto. Na rodada 21 do Brasileirao ela devolveu
  // "PST" em quatro jogos: procurar por "postponed" nao pegava nenhum, e os
  // jogos seguiam na rodada como se fossem acontecer.
  it('reconhece o codigo PST, que e o que a fonte realmente manda', () => {
    expect(isMatchPostponed(jogo({ apiStatus: 'PST' }))).toBe(true);
  });

  it('reconhece os demais codigos de jogo que nao acontece', () => {
    for (const c of ['PPD', 'CANC', 'ABD', 'SUSP', 'TBD']) {
      expect(isMatchPostponed(jogo({ apiStatus: c })), c).toBe(true);
    }
  });

  it('nao confunde com os codigos de jogo normal', () => {
    for (const c of ['NS', 'FT', '1H', 'HT', '2H', 'AET', 'PEN']) {
      expect(isMatchPostponed(jogo({ apiStatus: c })), c).toBe(false);
    }
  });

  it('aceita o campo proprio da fonte, que nem sempre concorda com o status', () => {
    expect(isMatchPostponed(jogo({ strPostponed: 'yes', apiStatus: 'NS' }))).toBe(true);
    // O contrario tambem vale: status PST com o campo dizendo "no" — foi
    // exatamente o que veio na rodada 21.
    expect(isMatchPostponed(jogo({ strPostponed: 'no', apiStatus: 'PST' }))).toBe(true);
  });

  it('nao confunde jogo normal', () => {
    expect(isMatchPostponed(jogo({ apiStatus: 'Not Started' }))).toBe(false);
    expect(isMatchPostponed(jogo({ apiStatus: 'Match Finished' }))).toBe(false);
    expect(isMatchPostponed(null)).toBe(false);
  });
});

describe('o que vale pontos', () => {
  it('jogo encerrado com placar vale', () => {
    expect(matchCountsForScoring(jogo({ homeScore: 2, awayScore: 1 }))).toBe(true);
  });

  it('jogo adiado NAO vale, mesmo se tiver placar', () => {
    // Nao vale para NINGUEM: quem palpitou nele nao perde nem ganha em relacao
    // aos outros, e a rodada continua justa.
    expect(matchCountsForScoring(jogo({ postponed: true, homeScore: 1, awayScore: 0 }))).toBe(false);
  });

  it('jogo sem placar nao vale', () => {
    expect(matchCountsForScoring(jogo({ homeScore: null, awayScore: null }))).toBe(false);
  });
});

describe('parar de esperar pelo jogo', () => {
  const agora = new Date('2026-08-10T23:00:00+00:00').getTime();

  it('adiado ja esta resolvido: nao adianta esperar placar que nao vem', () => {
    expect(isMatchSettled(jogo({ postponed: true }), agora)).toBe(true);
  });

  it('encerrado esta resolvido', () => {
    expect(isMatchSettled(jogo({ finished: true }), agora)).toBe(true);
  });

  it('com placar e tempo suficiente, resolvido', () => {
    expect(isMatchSettled(jogo({ homeScore: 1, awayScore: 1 }), agora)).toBe(true);
  });

  it('sem placar, ainda nao', () => {
    expect(isMatchSettled(jogo({}), agora)).toBe(false);
  });

  it('com placar mas recem-comecado, ainda nao', () => {
    const logoApos = new Date('2026-08-10T19:30:00+00:00').getTime();
    expect(isMatchSettled(jogo({ homeScore: 1, awayScore: 0 }), logoApos)).toBe(false);
  });
});

describe('resumo da rodada', () => {
  it('separa o que vale do que foi adiado', () => {
    const r = resumoDaRodada([
      jogo({ homeTeamName: 'Flamengo', awayTeamName: 'Vasco' }),
      jogo({ homeTeamName: 'Santos', awayTeamName: 'Corinthians', postponed: true }),
      jogo({ homeTeamName: 'Grêmio', awayTeamName: 'Inter' }),
    ]);
    expect(r).toMatchObject({ total: 3, adiados: 1, valendo: 2 });
    expect(r.nomesAdiados).toEqual(['Santos x Corinthians']);
  });

  it('aguenta rodada vazia', () => {
    expect(resumoDaRodada()).toMatchObject({ total: 0, adiados: 0, valendo: 0 });
  });
});
