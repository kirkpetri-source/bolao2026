import { describe, it, expect } from 'vitest';
import {
  STATUS, TRIAL_DAYS, GRACE_DAYS,
  trialSubscription, evaluateStatus, accessEndsAt, isBlocked, daysUntil,
} from '../api/_shared/subscription.js';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 6, 1); // 01/07/2026

describe('assinatura do SaaS', () => {
  it('nasce em teste de 7 dias', () => {
    const sub = trialSubscription(T0);
    expect(sub.status).toBe(STATUS.TRIAL);
    expect(sub.trialEndsAt).toBe(T0 + TRIAL_DAYS * DAY);
    expect(sub.currentPeriodEnd).toBeNull();
  });

  it('segue em teste durante os 7 dias', () => {
    const sub = trialSubscription(T0);
    expect(evaluateStatus(sub, T0)).toBe(STATUS.TRIAL);
    expect(evaluateStatus(sub, T0 + 6 * DAY)).toBe(STATUS.TRIAL);
    expect(evaluateStatus(sub, sub.trialEndsAt)).toBe(STATUS.TRIAL);
  });

  it('vence assim que o teste acaba, mas ainda nao bloqueia', () => {
    const sub = trialSubscription(T0);
    const status = evaluateStatus(sub, sub.trialEndsAt + 1);
    expect(status).toBe(STATUS.OVERDUE);
    expect(isBlocked(sub, sub.trialEndsAt + 1)).toBe(false);
  });

  it('bloqueia depois da cortesia', () => {
    const sub = trialSubscription(T0);
    const limite = sub.trialEndsAt + GRACE_DAYS * DAY;
    expect(evaluateStatus(sub, limite)).toBe(STATUS.OVERDUE);
    expect(evaluateStatus(sub, limite + 1)).toBe(STATUS.BLOCKED);
    expect(isBlocked(sub, limite + 1)).toBe(true);
  });

  it('quem pagou fica ativo ate o fim do periodo', () => {
    const sub = { ...trialSubscription(T0), currentPeriodEnd: T0 + 30 * DAY };
    expect(evaluateStatus(sub, T0 + 29 * DAY)).toBe(STATUS.ACTIVE);
    expect(evaluateStatus(sub, T0 + 30 * DAY)).toBe(STATUS.ACTIVE);
    expect(evaluateStatus(sub, T0 + 31 * DAY)).toBe(STATUS.OVERDUE);
  });

  it('o periodo pago manda sobre o fim do teste', () => {
    const sub = { ...trialSubscription(T0), currentPeriodEnd: T0 + 60 * DAY };
    // Ja passou dos 7 dias de teste, mas pagou: continua ativo.
    expect(accessEndsAt(sub)).toBe(T0 + 60 * DAY);
    expect(evaluateStatus(sub, T0 + 30 * DAY)).toBe(STATUS.ACTIVE);
  });

  it('pagamento tira do bloqueio', () => {
    const vencido = trialSubscription(T0);
    const depois = vencido.trialEndsAt + 10 * DAY;
    expect(evaluateStatus(vencido, depois)).toBe(STATUS.BLOCKED);
    const renovado = { ...vencido, currentPeriodEnd: depois + 30 * DAY };
    expect(evaluateStatus(renovado, depois)).toBe(STATUS.ACTIVE);
  });

  it('conta os dias restantes arredondando para cima', () => {
    expect(daysUntil(T0 + 2 * DAY, T0)).toBe(2);
    expect(daysUntil(T0 + 2 * DAY + 1000, T0)).toBe(3);
    expect(daysUntil(T0 - DAY, T0)).toBe(-1);
  });

  it('tenant sem assinatura gravada nao e tratado como bloqueado', () => {
    expect(evaluateStatus(null, T0)).toBe(STATUS.TRIAL);
    expect(isBlocked(undefined, T0)).toBe(false);
  });
});
