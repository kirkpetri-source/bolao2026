import { describe, it, expect } from 'vitest';
import { normalizeWhatsapp, composeReceiptMessage, formatDateTimeBR } from '../src/utils/payments.js';

describe('normalizeWhatsapp', () => {
  it('remove caracteres não numéricos e usa últimos 11 dígitos', () => {
    expect(normalizeWhatsapp('(11) 99999-9999')).toBe('11999999999');
    expect(normalizeWhatsapp('11999999999')).toBe('11999999999');
    expect(normalizeWhatsapp('5511999999999')).toBe('11999999999');
  });
});

describe('composeReceiptMessage', () => {
  it('monta mensagem com dados essenciais', () => {
    const when = new Date('2025-05-10T20:20:00Z');
    const msg = composeReceiptMessage({
      roundName: 'teste',
      nParticipations: 1,
      amountBRL: 'R$ 1,00',
      when,
      txId: 'abc123'
    });
    expect(msg).toMatch('✅ Pagamento confirmado');
    expect(msg).toMatch('Rodada: teste');
    expect(msg).toMatch('Participações: 1');
    expect(msg).toMatch('Valor pago: R$ 1,00');
    expect(msg).toMatch('Transação: abc123');
  });

  it('formata data/hora em pt-BR', () => {
    const s = formatDateTimeBR(new Date());
    expect(typeof s).toBe('string');
    expect(s.length).toBeGreaterThan(8);
  });
});