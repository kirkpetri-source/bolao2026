import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Guarda contra o laço de login que quebrou a entrada em produção.
//
// O App decide entre "mandar para /entrar" e "mostrar o painel". Quando esse
// ramo passou a NAVEGAR (window.location.replace) em vez de só renderizar uma
// tela, a condição virou perigosa: `view` nasce 'login' e só vira 'user'/'admin'
// num efeito, que roda DEPOIS do primeiro render. Com `view === 'login'` na
// condição, o primeiro render após o login redirecionava, a página recarregava,
// a sessão voltava, `view` era 'login' de novo — e o ciclo não terminava.
//
// Teste de código-fonte, no mesmo espírito de tests/jsxImports.test.js: o erro
// não aparece em teste de unidade nem no build, só no navegador de quem loga.

const APP = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'App.jsx'), 'utf8');

describe('redirecionamento para a tela de entrada', () => {
  it('o App redireciona para /entrar', () => {
    // Se este some, o resto do arquivo perde o sentido e precisa ser revisto.
    expect(APP).toMatch(/window\.location\.replace\(\s*destino\s*\)/);
  });

  it('só a AUSÊNCIA de sessão dispara o redirecionamento', () => {
    const trecho = APP.slice(0, APP.indexOf('window.location.replace'));
    const condicao = trecho.slice(trecho.lastIndexOf('if ('));

    expect(condicao).toContain('!currentUser');
    // O ponto do teste: `view` não pode entrar nesta condição.
    expect(condicao).not.toMatch(/view\s*===/);
  });

  it('logado, o App nunca devolve tela vazia', () => {
    // O fallback existia como `return null`, que piscava branco entre o login e
    // o efeito que ajusta a view.
    const fim = APP.slice(APP.lastIndexOf("if (view === 'user')"));
    expect(fim).toMatch(/return currentUser\.isAdmin \? <AdminPanel/);
    expect(fim).not.toMatch(/return null;/);
  });
});
