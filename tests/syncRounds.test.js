import { describe, it, expect } from 'vitest';
import { ehAdiado, horasDeDiferenca } from '../api/cron/sync-rounds.js';

// A tabela do Brasileirao muda: jogo troca de horario e jogo e adiado. Se o
// sistema nao percebe, fecha a rodada na hora errada e espera para sempre por
// um placar que nunca vem.

describe('deteccao de adiamento', () => {
  it('reconhece as variacoes que a API usa', () => {
    for (const s of ['Postponed', 'Match Postponed', 'PPD', 'postponed', 'Cancelled', 'Abandoned', 'Suspended']) {
      expect(ehAdiado(s), s).toBe(true);
    }
  });

  it('nao confunde jogo normal com adiado', () => {
    for (const s of ['Not Started', 'Match Finished', '1H', 'FT', '', null, undefined]) {
      expect(ehAdiado(s), String(s)).toBe(false);
    }
  });
});

describe('mudanca de horario', () => {
  const base = '2026-08-10T19:00:00+00:00';

  it('mede a diferenca em horas', () => {
    expect(horasDeDiferenca(base, '2026-08-10T21:00:00+00:00')).toBe(2);
    expect(horasDeDiferenca(base, '2026-08-11T19:00:00+00:00')).toBe(24);
  });

  it('nao liga para a ordem', () => {
    expect(horasDeDiferenca('2026-08-10T21:00:00+00:00', base)).toBe(2);
  });

  it('ignora meia hora, que e ruido de fuso ou arredondamento', () => {
    expect(horasDeDiferenca(base, '2026-08-10T19:30:00+00:00')).toBe(0.5);
  });

  it('devolve zero quando falta data, para nao inventar mudanca', () => {
    expect(horasDeDiferenca(null, base)).toBe(0);
    expect(horasDeDiferenca(base, null)).toBe(0);
    expect(horasDeDiferenca(undefined, undefined)).toBe(0);
    expect(horasDeDiferenca('data ruim', base)).toBe(0);
  });
});
