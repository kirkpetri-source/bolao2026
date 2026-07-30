import { describe, it, expect } from 'vitest';
import {
  rateio, cartelasParaPagarMensalidade, normalizaPercentuais, percentuaisDe,
  PADRAO_ADMIN_PCT, PADRAO_ESTABELECIMENTO_PCT, MAX_ADMIN_PCT,
} from '../api/_shared/rateio.js';
import { PROMO_PRICE_CENTS, PRICE_CENTS } from '../api/_shared/subscription.js';

describe('percentuais', () => {
  it('o padrão histórico é 85/10/5', () => {
    const p = normalizaPercentuais();
    expect(p).toEqual({ adminPct: 10, estabelecimentoPct: 5, premioPct: 85 });
  });

  it('o prêmio é o que sobra: subir a taxa desce o prêmio', () => {
    expect(normalizaPercentuais(20, 5).premioPct).toBe(75);
    expect(normalizaPercentuais(0, 0).premioPct).toBe(100);
  });

  it('as três partes sempre fecham em 100%', () => {
    for (const [a, e] of [[0, 0], [10, 5], [15, 10], [30, 20], [50, 50], [80, 40]]) {
      const p = normalizaPercentuais(a, e);
      expect(p.adminPct + p.estabelecimentoPct + p.premioPct).toBe(100);
    }
  });

  it('a taxa tem teto, para o prêmio não virar piada', () => {
    expect(normalizaPercentuais(90).adminPct).toBe(MAX_ADMIN_PCT);
  });

  it('valor inválido cai no padrão em vez de quebrar a conta', () => {
    expect(normalizaPercentuais('abc', null).adminPct).toBe(PADRAO_ADMIN_PCT);
    expect(normalizaPercentuais(undefined, -5).estabelecimentoPct).toBe(PADRAO_ESTABELECIMENTO_PCT);
  });
});

describe('percentuais escolhidos pelo organizador', () => {
  // O painel já salvava betConfig.fees e NENHUM cálculo lia: quem trocasse a
  // taxa continuava vendo 85/10/5. Este teste é a trava disso.
  it('lê a escolha gravada em settings', () => {
    const settings = { betConfig: { fees: { adminPercent: 20, establishmentPercent: 10 } } };
    expect(percentuaisDe(settings)).toEqual({ adminPct: 20, estabelecimentoPct: 10, premioPct: 70 });
  });

  it('bolão que nunca mexeu nas taxas continua no padrão', () => {
    expect(percentuaisDe({})).toEqual({ adminPct: 10, estabelecimentoPct: 5, premioPct: 85 });
    expect(percentuaisDe(null).premioPct).toBe(85);
    expect(percentuaisDe({ betConfig: {} }).adminPct).toBe(PADRAO_ADMIN_PCT);
  });
});

describe('rateio das cartelas', () => {
  it('divide a arrecadação da rodada no padrão', () => {
    const r = rateio(360);           // 24 cartelas de R$ 15
    expect(r.total).toBe(360);
    expect(r.premio).toBeCloseTo(306, 10);
    expect(r.administracao).toBeCloseTo(36, 10);
  });

  it('respeita a taxa escolhida', () => {
    const r = rateio(360, { adminPct: 20 });
    expect(r.administracao).toBeCloseTo(72, 10);
    expect(r.premio).toBeCloseTo(270, 10);   // 75% com estabelecimento em 5%
  });

  it('comissão do ponto de venda incide só nas cartelas dele', () => {
    const r = rateio(360, { cartelasComPontoDeVenda: 10, valorDaCartela: 15 });
    expect(r.estabelecimentos).toBeCloseTo(7.5, 10);   // 10 × 15 × 5%
  });

  it('sem ponto de venda não há comissão', () => {
    expect(rateio(360).estabelecimentos).toBe(0);
  });

  it('prêmio e taxa nunca somam mais que o arrecadado', () => {
    for (const admin of [0, 10, 25, 50]) {
      const r = rateio(1000, { adminPct: admin });
      expect(r.premio + r.administracao).toBeLessThanOrEqual(1000);
    }
  });

  it('não quebra com entrada inválida', () => {
    expect(rateio(null).total).toBe(0);
    expect(rateio(undefined).premio).toBe(0);
    expect(rateio('abc').administracao).toBe(0);
  });
});

describe('quantas cartelas pagam a mensalidade', () => {
  it('cartela de R$ 15 na taxa padrão', () => {
    const n = cartelasParaPagarMensalidade(PROMO_PRICE_CENTS, 15);
    expect(n).toBe(20);
    expect(rateio(n * 15).administracao).toBeGreaterThanOrEqual(PROMO_PRICE_CENTS / 100);
  });

  it('taxa maior exige menos cartelas', () => {
    expect(cartelasParaPagarMensalidade(PROMO_PRICE_CENTS, 15, 20)).toBe(10);
    expect(cartelasParaPagarMensalidade(PROMO_PRICE_CENTS, 30, 10)).toBe(10);
  });

  it('o número devolvido é sempre suficiente, nunca por baixo', () => {
    for (const valor of [5, 7, 12, 15, 20, 25, 33, 50]) {
      for (const taxa of [5, 10, 15, 25]) {
        const n = cartelasParaPagarMensalidade(PROMO_PRICE_CENTS, valor, taxa);
        const opc = { adminPct: taxa };
        expect(rateio(n * valor, opc).administracao).toBeGreaterThanOrEqual(PROMO_PRICE_CENTS / 100);
        expect(rateio((n - 1) * valor, opc).administracao).toBeLessThan(PROMO_PRICE_CENTS / 100);
      }
    }
  });

  it('vale para o preço cheio também', () => {
    const n = cartelasParaPagarMensalidade(PRICE_CENTS, 15);
    expect(rateio(n * 15).administracao).toBeGreaterThanOrEqual(PRICE_CENTS / 100);
  });

  it('taxa zero ou cartela zero não geram divisão por zero', () => {
    expect(cartelasParaPagarMensalidade(PROMO_PRICE_CENTS, 0)).toBe(Infinity);
    expect(cartelasParaPagarMensalidade(PROMO_PRICE_CENTS, 15, 0)).toBe(Infinity);
  });
});
