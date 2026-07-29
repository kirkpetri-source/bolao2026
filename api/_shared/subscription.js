// Assinatura do SaaS: o organizador paga a Lion Tech pelo uso da plataforma.
// Não confundir com api/payments/woovi-*, que é a aposta do participante indo
// para a conta do próprio organizador.
//
// Módulo sem dependências: o painel importa daqui para exibir os dias restantes,
// então a regra de quando bloquear vive num lugar só e não é reescrita no front.

export const TRIAL_DAYS = 7;
export const PRICE_CENTS = 4990;        // R$ 49,90
export const PROMO_PRICE_CENTS = 2990;  // R$ 29,90 de lançamento

// trial   → dentro dos 7 dias iniciais
// active  → mensalidade em dia
// overdue → venceu, ainda em cortesia (avisado, mas funcionando)
// blocked → painel travado e participantes impedidos de palpitar
export const STATUS = { TRIAL: 'trial', ACTIVE: 'active', OVERDUE: 'overdue', BLOCKED: 'blocked' };

// Dias entre o vencimento e o bloqueio efetivo. Existe para o organizador ter
// chance de pagar depois do aviso, em vez de o bolão parar de uma vez.
export const GRACE_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export function trialSubscription(now = Date.now()) {
  return {
    status: STATUS.TRIAL,
    trialEndsAt: now + TRIAL_DAYS * DAY_MS,
    currentPeriodEnd: null,
    priceCents: PROMO_PRICE_CENTS,
    lastChargeId: null,
    lastNotifiedAt: null,
    blockedAt: null,
  };
}

// Data em que o acesso acaba: fim do teste para quem nunca pagou, fim do
// período pago para os demais.
export function accessEndsAt(sub) {
  if (!sub) return 0;
  return Number(sub.currentPeriodEnd || sub.trialEndsAt || 0);
}

// Status que o tenant DEVERIA ter agora, dado o relógio. Pura, para poder testar.
export function evaluateStatus(sub, now = Date.now()) {
  const ends = accessEndsAt(sub);
  if (!ends) return STATUS.TRIAL;
  if (now <= ends) return sub?.currentPeriodEnd ? STATUS.ACTIVE : STATUS.TRIAL;
  if (now <= ends + GRACE_DAYS * DAY_MS) return STATUS.OVERDUE;
  return STATUS.BLOCKED;
}

export function isBlocked(sub, now = Date.now()) {
  return evaluateStatus(sub, now) === STATUS.BLOCKED;
}

export function daysUntil(ms, now = Date.now()) {
  return Math.ceil((Number(ms || 0) - now) / DAY_MS);
}

export const PERIOD_DAYS = 30;

// Novo fim de período ao confirmar um pagamento. Quem paga adiantado soma ao
// tempo que ainda tem; quem paga atrasado começa a contar de hoje, para não
// levar um mês já vencido.
export function renewedPeriodEnd(sub, now = Date.now()) {
  const base = Math.max(now, accessEndsAt(sub) || 0);
  return base + PERIOD_DAYS * DAY_MS;
}

