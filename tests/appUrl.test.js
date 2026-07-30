import { describe, it, expect } from 'vitest';
import { baseUrl, tenantUrl, rankingUrl, DOMINIO_PADRAO } from '../api/_shared/appUrl.js';

describe('baseUrl', () => {
  it('usa a env APP_URL quando existe', () => {
    expect(baseUrl({ APP_URL: 'https://brasilbolao.com.br' })).toBe('https://brasilbolao.com.br');
  });

  it('cai no domínio padrão quando a env está ausente ou vazia', () => {
    expect(baseUrl({})).toBe(DOMINIO_PADRAO);
    expect(baseUrl({ APP_URL: '   ' })).toBe(DOMINIO_PADRAO);
    expect(baseUrl(undefined)).toBeTruthy();
  });

  it('tira a barra final para não gerar link com barra dupla', () => {
    expect(baseUrl({ APP_URL: 'https://brasilbolao.com.br/' })).toBe('https://brasilbolao.com.br');
    expect(baseUrl({ APP_URL: 'https://brasilbolao.com.br///' })).toBe('https://brasilbolao.com.br');
  });

  // A regressão que motivou o módulo: o endereço não pode mais vir de um campo
  // gravado no banco, senão um valor antigo vence a env e o link sai no
  // domínio velho sem ninguém perceber.
  it('não aceita endereço vindo de settings', () => {
    const env = { APP_URL: 'https://brasilbolao.com.br' };
    const settings = { appUrl: 'https://bolao-brasileirao-2025-dev.vercel.app' };
    expect(baseUrl(env)).toBe('https://brasilbolao.com.br');
    expect(baseUrl(env)).not.toContain(settings.appUrl);
  });
});

describe('tenantUrl', () => {
  const env = { APP_URL: 'https://brasilbolao.com.br' };

  it('leva ao caminho do bolão, não à raiz', () => {
    expect(tenantUrl('bolao-do-kirk', env)).toBe('https://brasilbolao.com.br/bolao-do-kirk');
  });

  it('sem bolão devolve só a base', () => {
    expect(tenantUrl('', env)).toBe('https://brasilbolao.com.br');
    expect(tenantUrl(null, env)).toBe('https://brasilbolao.com.br');
  });

  it('escapa o que não é seguro em caminho', () => {
    expect(tenantUrl('bolão do kirk', env)).toBe('https://brasilbolao.com.br/bol%C3%A3o%20do%20kirk');
  });
});

describe('rankingUrl', () => {
  it('monta a página pública da rodada', () => {
    expect(rankingUrl('abc123', { APP_URL: 'https://brasilbolao.com.br' }))
      .toBe('https://brasilbolao.com.br/ranking/abc123');
  });
});
