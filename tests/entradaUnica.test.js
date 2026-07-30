import { describe, it, expect, beforeEach, vi } from 'vitest';
import { inviteUrl, sincronizarUrlComTenant, slugDaUrl } from '../src/tenant.js';

// A tela de login por bolão deixou de existir: tudo entra por /entrar. Estes
// testes travam as três pontas dessa unificação — o convite, o endereço curto
// que continua valendo e a barra de endereço depois do login.

function fingeNavegador(href) {
  const url = new URL(href);
  const replaceState = vi.fn();
  global.window = {
    location: { href, origin: url.origin, pathname: url.pathname, search: url.search },
    history: { replaceState },
  };
  return replaceState;
}

describe('convite do organizador', () => {
  beforeEach(() => { fingeNavegador('https://brasilbolao.com.br/bolao-do-kirk'); });

  it('aponta para a tela única, com o bolão e o cadastro abertos', () => {
    expect(inviteUrl('bolao-do-kirk'))
      .toBe('https://brasilbolao.com.br/entrar?bolao=bolao-do-kirk&cadastro=1');
  });

  it('escapa nome de bolão com caractere especial', () => {
    expect(inviteUrl('bolão do zé')).toContain('bolao=bol%C3%A3o%20do%20z%C3%A9');
  });
});

describe('endereço curto continua sendo endereço de bolão', () => {
  // Há links /nome-do-bolao já enviados no WhatsApp de muita gente: o App
  // redireciona para /entrar, mas o slug precisa continuar sendo reconhecido.
  it('reconhece o bolão no caminho', () => {
    fingeNavegador('https://brasilbolao.com.br/bolao-do-kirk');
    expect(slugDaUrl('https://brasilbolao.com.br/bolao-do-kirk')).toBe('bolao-do-kirk');
  });

  it('/entrar não é bolão', () => {
    expect(slugDaUrl('https://brasilbolao.com.br/entrar')).toBe(null);
    expect(slugDaUrl('https://brasilbolao.com.br/entrar?bolao=x')).toBe(null);
  });
});

describe('barra de endereço depois do login', () => {
  it('sai de /entrar e passa a mostrar o bolão', () => {
    const replaceState = fingeNavegador('https://brasilbolao.com.br/entrar?bolao=bolao-do-kirk&cadastro=1');
    sincronizarUrlComTenant('bolao-do-kirk');
    expect(replaceState).toHaveBeenCalledWith({}, '', '/bolao-do-kirk');
  });

  it('não carrega a query do convite para dentro do bolão', () => {
    // Levar ?cadastro=1 adiante reabriria o cadastro com a sessão já aberta.
    const replaceState = fingeNavegador('https://brasilbolao.com.br/entrar?bolao=x&cadastro=1');
    sincronizarUrlComTenant('bolao-do-tche');
    expect(replaceState.mock.calls[0][2]).toBe('/bolao-do-tche');
  });

  it('não mexe nas outras rotas do site', () => {
    for (const rota of ['/plataforma', '/ranking/abc123']) {
      const replaceState = fingeNavegador(`https://brasilbolao.com.br${rota}`);
      sincronizarUrlComTenant('bolao-do-kirk');
      expect(replaceState, rota).not.toHaveBeenCalled();
    }
  });

  it('já estando no bolão certo, não reescreve à toa', () => {
    const replaceState = fingeNavegador('https://brasilbolao.com.br/bolao-do-kirk');
    sincronizarUrlComTenant('bolao-do-kirk');
    expect(replaceState).not.toHaveBeenCalled();
  });
});
