import { describe, it, expect } from 'vitest';
import { validaSenha, forcaSenha, MIN_SENHA } from '../api/_shared/senha.js';

describe('validação de senha', () => {
  it('aceita uma senha razoável', () => {
    expect(validaSenha('cerveja2026').ok).toBe(true);
    expect(validaSenha('BolaoDoZe77').ok).toBe(true);
  });

  it('exige tamanho mínimo', () => {
    expect(validaSenha('abc12').ok).toBe(false);
    expect(validaSenha('a'.repeat(MIN_SENHA - 1)).ok).toBe(false);
  });

  it('recusa só números — é onde mora a data de nascimento', () => {
    expect(validaSenha('19850712').ok).toBe(false);
    expect(validaSenha('987654321').ok).toBe(false);
  });

  it('recusa repetição e sequência', () => {
    expect(validaSenha('aaaaaaaa').ok).toBe(false);
    expect(validaSenha('12345678').ok).toBe(false);
    expect(validaSenha('abcdefgh').ok).toBe(false);
    expect(validaSenha('87654321').ok).toBe(false);
  });

  it('recusa as senhas mais vazadas', () => {
    expect(validaSenha('password').ok).toBe(false);
    expect(validaSenha('Senha123'.toLowerCase()).ok).toBe(false);
    expect(validaSenha('flamengo').ok).toBe(false);
  });

  // O identificador do participante é o WhatsApp, e ele está no grupo: senha
  // que contém o próprio número não protege de ninguém.
  it('recusa senha que contém o WhatsApp', () => {
    const r = validaSenha('zap64999555364', { whatsapp: '64999555364' });
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/WhatsApp/);
  });

  it('recusa senha que contém o primeiro nome', () => {
    expect(validaSenha('kirkdouglas1', { nome: 'Kirk Douglas' }).ok).toBe(false);
    // Nome curto não bloqueia: "ana" apareceria em senha demais por acaso.
    expect(validaSenha('ana2026forte', { nome: 'Ana Paula' }).ok).toBe(true);
  });

  it('devolve mensagem pronta para a tela', () => {
    const r = validaSenha('123');
    expect(r.erro.length).toBeGreaterThan(10);
  });

  it('não quebra com entrada vazia ou nula', () => {
    expect(validaSenha('').ok).toBe(false);
    expect(validaSenha(null).ok).toBe(false);
    expect(validaSenha(undefined, {}).ok).toBe(false);
  });
});

describe('medidor de força', () => {
  it('sobe com tamanho e variedade', () => {
    expect(forcaSenha('cerveja2').nivel).toBeLessThan(forcaSenha('cerveja2026!').nivel);
  });

  it('zera para senha proibida, por mais longa que seja', () => {
    expect(forcaSenha('1234567890').nivel).toBe(0);
    expect(forcaSenha('aaaaaaaaaaaa').nivel).toBe(0);
  });

  it('senha vazia não tem rótulo', () => {
    expect(forcaSenha('').rotulo).toBe('');
  });
});
