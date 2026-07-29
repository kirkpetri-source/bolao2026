import { describe, it, expect } from 'vitest';
import { emailKey } from '../api/_shared/emailIndex.js';

// Reservar e liberar o e-mail precisam derivar o MESMO id. Se divergirem, a
// liberação não acha o documento e o endereço fica travado para sempre.
describe('chave do indice de e-mail', () => {
  it('e estavel para o mesmo endereco', () => {
    expect(emailKey('kirk@liontechti.com.br')).toBe(emailKey('kirk@liontechti.com.br'));
  });

  it('ignora diferenca de caixa', () => {
    expect(emailKey('Kirk@LionTechTI.com.br')).toBe(emailKey('kirk@liontechti.com.br'));
  });

  it('preserva os caracteres validos de e-mail', () => {
    expect(emailKey('kirk.douglas+bolao@liontechti.com.br'))
      .toBe('kirk.douglas+bolao@liontechti.com.br');
  });

  it('troca caractere que quebraria o id do documento', () => {
    // Barra separa caminho no Firestore e nao pode ir crua no id.
    expect(emailKey('a/b@x.com')).toBe('a_b@x.com');
    expect(emailKey('a b@x.com')).toBe('a_b@x.com');
  });

  it('respeita o limite de tamanho', () => {
    expect(emailKey('a'.repeat(300) + '@x.com').length).toBe(200);
  });

  it('devolve vazio para entrada vazia, para nao apagar doc errado', () => {
    expect(emailKey('')).toBe('');
    expect(emailKey(null)).toBe('');
    expect(emailKey(undefined)).toBe('');
  });
});
