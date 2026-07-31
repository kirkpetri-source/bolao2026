import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { resolveTenantId, tenantPedidoNaUrl } from '../src/tenant.js';

// Quem recebe o convite de um bolão, JÁ TEM CONTA e faz login precisa cair
// naquele bolão — não no último que ele usou. Sem isso, o link do organizador
// vira decoração para quem já é cadastrado em outro bolão.

function fingeNavegador(href) {
  global.window = {
    location: { href, origin: new URL(href).origin, pathname: new URL(href).pathname, search: new URL(href).search },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  global.localStorage = global.window.localStorage;
}

describe('bolão do convite', () => {
  it('o parâmetro ?bolao= é reconhecido como bolão', () => {
    fingeNavegador('https://brasilbolao.com.br/entrar?bolao=bolao-demonstracao&cadastro=1');
    expect(tenantPedidoNaUrl()).toBe('bolao-demonstracao');
    expect(resolveTenantId()).toBe('bolao-demonstracao');
  });

  it('o formato antigo ?t= continua valendo', () => {
    fingeNavegador('https://brasilbolao.com.br/entrar?t=bolao-do-kirk');
    expect(tenantPedidoNaUrl()).toBe('bolao-do-kirk');
  });

  it('o caminho tem prioridade sobre o parâmetro', () => {
    fingeNavegador('https://brasilbolao.com.br/bolao-do-tche?bolao=outro-bolao');
    expect(tenantPedidoNaUrl()).toBe('bolao-do-tche');
  });

  it('/entrar sem parâmetro não escolhe bolão nenhum', () => {
    fingeNavegador('https://brasilbolao.com.br/entrar');
    expect(resolveTenantId()).toBe(null);
  });
});

// O ramo de /entrar tem de ser decidido ANTES de qualquer coisa que dependa do
// bolão: com ?bolao= resolvendo um tenant, uma condição do tipo
// `!tenantId && !currentUser` deixaria de valer nessa tela e a execução cairia
// no redirecionamento — que manda para /entrar de novo. Laço.
describe('a tela de entrada não pode depender de haver bolão', () => {
  const APP = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'App.jsx'), 'utf8');

  it('/entrar é decidido antes do redirecionamento', () => {
    const posEntrada = APP.indexOf('if (ehRotaDeEntrada()) return <Entrada');
    const posRedirect = APP.indexOf('window.location.replace');
    expect(posEntrada).toBeGreaterThan(0);
    expect(posEntrada).toBeLessThan(posRedirect);
  });

  it('a condição da tela de entrada não exige ausência de bolão', () => {
    expect(APP).not.toMatch(/if \(!tenantId && !currentUser\) \{\s*\n\s*return ehRotaDeEntrada/);
  });
});

// O laço de 31/07: em /entrar?bolao=X o bolão já é resolvido, e o efeito que
// sincroniza a barra de endereço reescrevia a URL para /X. O App então deixava
// de reconhecer a rota de entrada, redirecionava para /entrar?bolao=X, e
// recomeçava. Na tela de entrada o endereço tem de continuar sendo /entrar.
describe('a barra de endereço só é reescrita com sessão', () => {
  const APP = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'App.jsx'), 'utf8');

  it('a chamada é condicionada ao usuário logado', () => {
    expect(APP).toMatch(/if \(currentUser\) sincronizarUrlComTenant\(tenantId\)/);
  });

  it('não existe chamada solta, fora da condição', () => {
    const solta = /useEffect\(\(\) => \{ sincronizarUrlComTenant\(tenantId\); \}/;
    expect(APP).not.toMatch(solta);
  });
});
