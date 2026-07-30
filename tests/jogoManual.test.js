import { describe, it, expect } from 'vitest';
import {
  isMatchManual, temJogoManual, jogosManuaisPendentes, podeFinalizarAutomaticamente,
} from '../api/_shared/matchStatus.js';

const auto = (extra = {}) => ({ apiEventId: '123', homeScore: 1, awayScore: 0, finished: true, ...extra });
const manual = (extra = {}) => ({ manual: true, homeScore: null, awayScore: null, ...extra });

describe('jogo manual', () => {
  it('só é manual quem foi marcado como manual', () => {
    expect(isMatchManual(manual())).toBe(true);
    expect(isMatchManual(auto())).toBe(false);
    // Jogo oficial sem apiEventId NÃO pode ser confundido com manual: seria
    // travar a rodada inteira esperando um placar que a automação traria.
    expect(isMatchManual({ homeScore: 1, awayScore: 1 })).toBe(false);
    expect(isMatchManual(null)).toBe(false);
  });

  it('reconhece a rodada que tem jogo manual', () => {
    expect(temJogoManual([auto(), manual()])).toBe(true);
    expect(temJogoManual([auto(), auto()])).toBe(false);
    expect(temJogoManual([])).toBe(false);
  });
});

describe('pendências que seguram a apuração', () => {
  it('jogo manual sem placar fica pendente', () => {
    expect(jogosManuaisPendentes([manual()])).toHaveLength(1);
  });

  it('jogo manual com placar deixa de ser pendência', () => {
    expect(jogosManuaisPendentes([manual({ homeScore: 2, awayScore: 1 })])).toHaveLength(0);
  });

  it('placar zero a zero conta como preenchido', () => {
    // A armadilha clássica: 0 é falsy. Se a checagem fosse `!m.homeScore`, um
    // 0x0 lançado ficaria eternamente pendente.
    expect(jogosManuaisPendentes([manual({ homeScore: 0, awayScore: 0 })])).toHaveLength(0);
  });

  it('jogo manual adiado não segura a rodada', () => {
    expect(jogosManuaisPendentes([manual({ apiStatus: 'PST' })])).toHaveLength(0);
  });

  it('jogo automático sem placar não entra na lista de manuais', () => {
    expect(jogosManuaisPendentes([{ homeScore: null, awayScore: null }])).toHaveLength(0);
  });
});

describe('quem pode encerrar a rodada', () => {
  it('rodada só com jogos oficiais encerra sozinha', () => {
    expect(podeFinalizarAutomaticamente({ matches: [auto(), auto()] })).toBe(true);
  });

  it('rodada com jogo manual espera o organizador — mesmo com placar lançado', () => {
    // Continua dele a última palavra: o cron não publica ranking de rodada
    // manual, senão o organizador perderia o controle do que anunciou.
    expect(podeFinalizarAutomaticamente({ matches: [auto(), manual({ homeScore: 1, awayScore: 1 })] })).toBe(false);
  });

  it('rodada sem jogos não trava', () => {
    expect(podeFinalizarAutomaticamente({ matches: [] })).toBe(true);
    expect(podeFinalizarAutomaticamente({})).toBe(true);
  });
});
