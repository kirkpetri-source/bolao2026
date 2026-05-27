/**
 * Testes unitários — Lógica de finalização de partidas
 *
 * Cobre o bug crítico: sistema fechando rodadas antes do apito final
 * em jogos com acréscimos, prorrogação ou pênaltis.
 *
 * Replica a lógica de isEffectivelyFinished / isMatchEffectivelyFinished
 * sem dependência de Firebase ou API externa.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Lógica replicada de bolao-engine.js ───────────────────────────────────────
const FINISH_AFTER_MS = 170 * 60 * 1000;
const IN_PROGRESS_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'INT', 'LIVE']);

function isEffectivelyFinished(match) {
  if (match.finished) return true;
  if (match.homeScore == null || match.awayScore == null) return false;
  if (!match.date) return false;
  if (match.matchStatus && IN_PROGRESS_STATUSES.has(match.matchStatus)) return false;
  return Date.now() - new Date(match.date).getTime() >= FINISH_AFTER_MS;
}

// ─── Lógica replicada de footballApi.js ───────────────────────────────────────
const TERMINAL_STATUSES = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);

function mapApiStatus(short) {
  return {
    matchStatus: short,
    finished: TERMINAL_STATUSES.has(short)
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function matchAt(minutesAgo, overrides = {}) {
  const date = new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
  return { date, homeScore: 1, awayScore: 1, finished: false, ...overrides };
}

// ─── Suite 1: Status da API-Football ──────────────────────────────────────────
describe('mapApiStatus — mapeamento de status da API-Football', () => {
  it('deve marcar FT como finalizado', () => {
    expect(mapApiStatus('FT').finished).toBe(true);
  });

  it('deve marcar AET (prorrogação) como finalizado', () => {
    expect(mapApiStatus('AET').finished).toBe(true);
  });

  it('deve marcar PEN (pênaltis) como finalizado', () => {
    expect(mapApiStatus('PEN').finished).toBe(true);
  });

  it('deve marcar AWD (vitória por WO) como finalizado', () => {
    expect(mapApiStatus('AWD').finished).toBe(true);
  });

  it('deve marcar WO (walkover) como finalizado', () => {
    expect(mapApiStatus('WO').finished).toBe(true);
  });

  it('NÃO deve marcar ET (prorrogação em andamento) como finalizado', () => {
    expect(mapApiStatus('ET').finished).toBe(false);
  });

  it('NÃO deve marcar P (pênaltis em andamento) como finalizado', () => {
    expect(mapApiStatus('P').finished).toBe(false);
  });

  it('NÃO deve marcar BT (intervalo da prorrogação) como finalizado', () => {
    expect(mapApiStatus('BT').finished).toBe(false);
  });

  it('NÃO deve marcar 2H (2º tempo) como finalizado', () => {
    expect(mapApiStatus('2H').finished).toBe(false);
  });

  it('NÃO deve marcar HT (intervalo) como finalizado', () => {
    expect(mapApiStatus('HT').finished).toBe(false);
  });

  it('NÃO deve marcar 1H (1º tempo) como finalizado', () => {
    expect(mapApiStatus('1H').finished).toBe(false);
  });
});

// ─── Suite 2: isEffectivelyFinished — proteção por matchStatus ─────────────────
describe('isEffectivelyFinished — proteção contra fechamento prematuro', () => {
  it('deve reconhecer jogo com finished=true como encerrado', () => {
    const match = matchAt(120, { finished: true });
    expect(isEffectivelyFinished(match)).toBe(true);
  });

  it('NÃO deve finalizar jogo com matchStatus=ET (prorrogação)', () => {
    // Jogo iniciou há 120 min — sem a proteção seria finalizado pelo fallback de 170 min
    // Mas com ET em andamento, deve aguardar
    const match = matchAt(120, { matchStatus: 'ET' });
    expect(isEffectivelyFinished(match)).toBe(false);
  });

  it('NÃO deve finalizar jogo com matchStatus=P (pênaltis em andamento)', () => {
    const match = matchAt(155, { matchStatus: 'P' });
    expect(isEffectivelyFinished(match)).toBe(false);
  });

  it('NÃO deve finalizar jogo com matchStatus=BT (intervalo da prorrogação)', () => {
    const match = matchAt(100, { matchStatus: 'BT' });
    expect(isEffectivelyFinished(match)).toBe(false);
  });

  it('NÃO deve finalizar jogo com matchStatus=2H (2º tempo em andamento)', () => {
    const match = matchAt(90, { matchStatus: '2H' });
    expect(isEffectivelyFinished(match)).toBe(false);
  });

  it('NÃO deve finalizar jogo sem placar', () => {
    const match = matchAt(200, { homeScore: null, awayScore: null });
    expect(isEffectivelyFinished(match)).toBe(false);
  });

  it('NÃO deve finalizar jogo sem data', () => {
    expect(isEffectivelyFinished({ homeScore: 1, awayScore: 0, finished: false })).toBe(false);
  });

  it('deve finalizar jogo com matchStatus=FT após tempo suficiente', () => {
    // FT não está em IN_PROGRESS_STATUSES, e placar presente — usa fallback de tempo
    const match = matchAt(175, { matchStatus: 'FT' });
    expect(isEffectivelyFinished(match)).toBe(true);
  });

  it('deve finalizar jogo com matchStatus=AET após tempo suficiente', () => {
    const match = matchAt(175, { matchStatus: 'AET' });
    expect(isEffectivelyFinished(match)).toBe(true);
  });
});

// ─── Suite 3: Fallback por tempo ───────────────────────────────────────────────
describe('isEffectivelyFinished — fallback por tempo (sem matchStatus da API)', () => {
  it('NÃO deve finalizar jogo sem matchStatus com menos de 170 min', () => {
    // Jogo a 115 min (antiga constante incorreta) — não deve disparar com a nova constante
    const match = matchAt(115);
    expect(isEffectivelyFinished(match)).toBe(false);
  });

  it('NÃO deve finalizar jogo sem matchStatus com 169 min', () => {
    const match = matchAt(169);
    expect(isEffectivelyFinished(match)).toBe(false);
  });

  it('deve finalizar jogo sem matchStatus com 170 min (limite do fallback)', () => {
    const match = matchAt(171); // ligeiramente acima para evitar flakiness de timing
    expect(isEffectivelyFinished(match)).toBe(true);
  });
});

// ─── Suite 4: Rodada só deve fechar quando TODOS os jogos estiverem finalizados ─
describe('Finalização de rodada — todos os jogos devem estar encerrados', () => {
  it('rodada com 1 jogo em ET NÃO deve ser considerada completa', () => {
    const matches = [
      matchAt(175, { finished: true }),  // jogo 1: encerrado
      matchAt(120, { matchStatus: 'ET' }) // jogo 2: prorrogação em andamento
    ];
    const allDone = matches.every(isEffectivelyFinished);
    expect(allDone).toBe(false);
  });

  it('rodada com 1 jogo em P (pênaltis) NÃO deve ser considerada completa', () => {
    const matches = [
      matchAt(175, { finished: true }),
      matchAt(160, { matchStatus: 'P' })
    ];
    const allDone = matches.every(isEffectivelyFinished);
    expect(allDone).toBe(false);
  });

  it('rodada onde TODOS os jogos têm finished=true deve ser considerada completa', () => {
    const matches = [
      matchAt(175, { finished: true }),
      matchAt(180, { finished: true })
    ];
    const allDone = matches.every(isEffectivelyFinished);
    expect(allDone).toBe(true);
  });

  it('rodada com jogo sem placar NÃO deve ser considerada completa', () => {
    const matches = [
      matchAt(175, { finished: true }),
      matchAt(200, { homeScore: null, awayScore: null })
    ];
    const allDone = matches.every(isEffectivelyFinished);
    expect(allDone).toBe(false);
  });
});
