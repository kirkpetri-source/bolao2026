import { describe, it, expect } from 'vitest';
import { isTaxIdValido, normalizeTaxId, mascaraTaxId } from '../api/_shared/taxid.js';

describe('CPF', () => {
  it('aceita CPF valido com e sem formatacao', () => {
    expect(isTaxIdValido('529.982.247-25')).toBe(true);
    expect(isTaxIdValido('52998224725')).toBe(true);
  });

  it('recusa digito verificador errado', () => {
    expect(isTaxIdValido('52998224726')).toBe(false);
    expect(isTaxIdValido('11144477736')).toBe(false);
  });

  it('recusa sequencia repetida, que passa na conta mas nao existe', () => {
    expect(isTaxIdValido('11111111111')).toBe(false);
    expect(isTaxIdValido('00000000000')).toBe(false);
  });

  it('recusa tamanho errado', () => {
    expect(isTaxIdValido('5299822472')).toBe(false);
    expect(isTaxIdValido('529982247255')).toBe(false);
  });
});

describe('CNPJ', () => {
  it('aceita CNPJ valido com e sem formatacao', () => {
    expect(isTaxIdValido('11.222.333/0001-81')).toBe(true);
    expect(isTaxIdValido('11222333000181')).toBe(true);
  });

  it('aceita o CNPJ da Lion Tech', () => {
    expect(isTaxIdValido('44.124.574/0001-47')).toBe(true);
  });

  it('recusa digito verificador errado', () => {
    expect(isTaxIdValido('11222333000182')).toBe(false);
  });

  it('recusa sequencia repetida', () => {
    expect(isTaxIdValido('11111111111111')).toBe(false);
  });
});

describe('normalizacao e mascara', () => {
  it('normaliza deixando so digitos', () => {
    expect(normalizeTaxId('529.982.247-25')).toBe('52998224725');
    expect(normalizeTaxId(' 11.222.333/0001-81 ')).toBe('11222333000181');
  });

  it('mascara sem revelar o documento inteiro', () => {
    const m = mascaraTaxId('52998224725');
    expect(m).toBe('***.982.247-**');
    expect(m).not.toContain('529');
    expect(mascaraTaxId('11222333000181')).toBe('**.222.333/****-**');
  });

  it('devolve vazio para entrada invalida', () => {
    expect(mascaraTaxId('123')).toBe('');
    expect(mascaraTaxId('')).toBe('');
  });
});
