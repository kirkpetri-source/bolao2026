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

const oficial = (over = {}) => ({
  number: 21, apiRoundNumber: 21, name: 'Rodada 21', status: 'upcoming',
  matches: [{ id: 1 }], autoSyncedAt: new Date(), ...over,
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
    const db = fakeDb({ rodadasDaFonte: [oficial({ status: 'finished' }), oficial({ status: 'closed' })] });
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
