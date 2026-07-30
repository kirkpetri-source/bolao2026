import { describe, it, expect } from 'vitest';
import { slugDaUrl, CAMINHOS_RESERVADOS } from '../src/tenant.js';

const url = (p) => `https://bolao.app${p}`;

describe('endereço do bolão no caminho', () => {
  it('reconhece o bolão', () => {
    expect(slugDaUrl(url('/bolao-do-deryck'))).toBe('bolao-do-deryck');
    expect(slugDaUrl(url('/bolaododeryck'))).toBe('bolaododeryck');
  });

  it('ignora maiúsculas e barra no fim', () => {
    expect(slugDaUrl(url('/Bolao-Do-Deryck/'))).toBe('bolao-do-deryck');
  });

  it('a raiz não é bolão — é a página de entrada', () => {
    expect(slugDaUrl(url('/'))).toBe(null);
    expect(slugDaUrl(url(''))).toBe(null);
  });

  // Um bolão chamado "plataforma" sequestraria o console; "ranking" quebraria
  // a página pública. Por isso a lista de reservados existe dos dois lados.
  it('não confunde rota do site com bolão', () => {
    for (const r of ['/plataforma', '/entrar', '/api', '/assets', '/version.json', '/favicon.ico']) {
      expect(slugDaUrl(url(r)), r).toBe(null);
    }
  });

  it('caminho com mais de um trecho não é bolão', () => {
    expect(slugDaUrl(url('/ranking/abc123'))).toBe(null);
    expect(slugDaUrl(url('/bolao/do/deryck'))).toBe(null);
  });

  it('recusa formato que não seria um slug válido', () => {
    expect(slugDaUrl(url('/ab'))).toBe(null);            // curto demais
    expect(slugDaUrl(url('/bolão-do-zé'))).toBe(null);   // acento não entra no slug
    expect(slugDaUrl(url('/bolao_do_ze'))).toBe(null);   // underscore não é usado
  });

  it('a lista de reservados cobre as rotas do site', () => {
    for (const r of ['plataforma', 'entrar', 'ranking', 'api', 'assets']) {
      expect(CAMINHOS_RESERVADOS.has(r), r).toBe(true);
    }
  });
});
