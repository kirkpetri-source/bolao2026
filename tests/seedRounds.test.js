import { describe, it, expect, vi } from 'vitest';
import { seedRoundsForTenant } from '../api/_shared/seedRounds.js';

// Firestore de mentira, só com o que o seed usa: where/limit/get, batch e doc().
function fakeDb({ rodadasDoNovo = [], rodadasDaFonte = [] }) {
  const criadas = [];
  const snap = (docs) => ({ empty: docs.length === 0, size: docs.length, docs: docs.map(d => ({ data: () => d })) });

  return {
    criadas,
    collection(nome) {
      if (nome !== 'rounds') throw new Error('coleção inesperada: ' + nome);
      const q = (tenant) => ({
        limit: () => ({ get: async () => snap(tenant === 'novo' ? rodadasDoNovo : rodadasDaFonte) }),
        get: async () => snap(tenant === 'novo' ? rodadasDoNovo : rodadasDaFonte),
      });
      return {
        where: (_campo, _op, valor) => q(valor === 'novo' ? 'novo' : 'fonte'),
        get: async () => snap([...rodadasDoNovo, ...rodadasDaFonte]),
        doc: () => ({ __novoDoc: true }),
      };
    },
    batch() {
      return { set: (_ref, dados) => criadas.push(dados), commit: async () => {} };
    },
  };
}

const DIA = 24 * 60 * 60 * 1000;
const daquiA = (ms) => new Date(Date.now() + ms).toISOString();

const oficial = (over = {}) => ({
  number: 21, apiRoundNumber: 21, name: 'Rodada 21', status: 'upcoming',
  matches: [{ id: 1, date: daquiA(10 * DIA) }], autoSyncedAt: new Date(), ...over,
});

describe('semear rodadas de um bolao novo', () => {
  it('copia rodada oficial em aberto', async () => {
    const db = fakeDb({ rodadasDaFonte: [oficial()] });
    const r = await seedRoundsForTenant(db, 'novo');
    expect(r.criadas).toBe(1);
    expect(db.criadas[0]).toMatchObject({ tenantId: 'novo', number: 21, apiRoundNumber: 21 });
  });

  it('NAO copia rodada criada a mao no painel', async () => {
    // Sem autoSyncedAt: o painel permite criar rodada personalizada, e ela nao
    // existe no Brasileirao — plantar isso num bolao novo criaria jogo fantasma.
    const db = fakeDb({ rodadasDaFonte: [oficial({ autoSyncedAt: null })] });
    const r = await seedRoundsForTenant(db, 'novo');
    expect(r.criadas).toBe(0);
  });

  it('NAO copia rodada sem numero da API', async () => {
    // Sem apiRoundNumber o sync diario nunca casaria com ela: ficaria orfa.
    const db = fakeDb({ rodadasDaFonte: [oficial({ apiRoundNumber: undefined })] });
    expect((await seedRoundsForTenant(db, 'novo')).criadas).toBe(0);
  });

  it('NAO copia rodada sem jogos', async () => {
    const db = fakeDb({ rodadasDaFonte: [oficial({ matches: [] })] });
    expect((await seedRoundsForTenant(db, 'novo')).criadas).toBe(0);
  });

  it('NAO copia rodada ja encerrada', async () => {
    const db = fakeDb({ rodadasDaFonte: [
      oficial({ status: 'finished', matches: [{ id: 1, date: daquiA(-30 * DIA) }] }),
      oficial({ status: 'closed', matches: [{ id: 1, date: daquiA(-10 * DIA) }] }),
    ] });
    expect((await seedRoundsForTenant(db, 'novo')).criadas).toBe(0);
  });

  it('NAO abre rodada com jogo ja em andamento, e avisa qual foi', async () => {
    // O status guardado so muda quando o cron passa: uma rodada pode estar
    // gravada como "open" com a bola ja rolando. Copiar assim deixaria alguem
    // palpitar vendo o jogo acontecer.
    const db = fakeDb({ rodadasDaFonte: [
      oficial({ number: 21, status: 'open', matches: [{ id: 1, date: daquiA(-2 * 36e5) }] }),
      oficial({ number: 22, matches: [{ id: 1, date: daquiA(9 * DIA) }] }),
    ] });
    const r = await seedRoundsForTenant(db, 'novo');
    expect(r.criadas).toBe(1);
    expect(r.emAndamento).toEqual([21]);
    expect(db.criadas[0].number).toBe(22);
  });

  it('recalcula o status pela data do jogo, nao pelo que estava gravado', async () => {
    const db = fakeDb({ rodadasDaFonte: [
      oficial({ number: 22, status: 'upcoming', matches: [{ id: 1, date: daquiA(2 * DIA) }] }),
      oficial({ number: 23, status: 'open', matches: [{ id: 1, date: daquiA(20 * DIA) }] }),
    ] });
    await seedRoundsForTenant(db, 'novo');
    // Jogo em 2 dias entra aberta; jogo em 20 dias entra como futura.
    expect(db.criadas.find(c => c.number === 22).status).toBe('open');
    expect(db.criadas.find(c => c.number === 23).status).toBe('upcoming');
  });

  it('NAO copia rodada sem data de jogo, por nao dar para garantir', async () => {
    const db = fakeDb({ rodadasDaFonte: [oficial({ matches: [{ id: 1 }] })] });
    expect((await seedRoundsForTenant(db, 'novo')).criadas).toBe(0);
  });

  it('nao mexe em bolao que ja tem rodadas', async () => {
    const db = fakeDb({ rodadasDoNovo: [oficial()], rodadasDaFonte: [oficial()] });
    const r = await seedRoundsForTenant(db, 'novo');
    expect(r.criadas).toBe(0);
    expect(r.motivo).toBe('o bolão já tem rodadas');
  });

  it('zera as marcas de notificacao ao copiar', async () => {
    // O bolao novo nao pode "ja ter avisado" sobre rodada que ele nunca teve.
    const db = fakeDb({ rodadasDaFonte: [oficial({ status: 'open', notificacaoFechamentoEnviada: true, resultadoCalculado: true })] });
    await seedRoundsForTenant(db, 'novo');
    expect(db.criadas[0]).toMatchObject({
      notificacaoFechamentoEnviada: false,
      resultadoCalculado: false,
      alertaFaltando1hEnviado: false,
    });
  });
});
