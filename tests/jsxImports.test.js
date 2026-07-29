import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Guarda contra um erro que o build NAO pega: usar um componente em JSX sem
// importar. O Vite compila normalmente e a tela so quebra quando o trecho
// renderiza — foi assim que o painel do organizador caiu inteiro com
// "ChevronRight is not defined", depois de build e testes passando.

const RAIZ = path.resolve(__dirname, '..', 'src');

function arquivosJsx(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : arquivosJsx(p);
    return e.name.endsWith('.jsx') ? [p] : [];
  });
}

function naoDefinidos(src) {
  const usados = new Set([...src.matchAll(/<([A-Z][A-Za-z0-9_]*)[\s/>]/g)].map(m => m[1]));

  const disponiveis = new Set(['Fragment']);
  for (const m of src.matchAll(/import\s+([^;]+?)\s+from/g)) {
    m[1].replace(/[{}]/g, ' ').split(',').forEach(parte => {
      const nome = parte.trim().split(/\s+as\s+/).pop().trim();
      if (nome) disponiveis.add(nome);
    });
  }
  // Componentes declarados no proprio arquivo.
  for (const m of src.matchAll(/(?:const|function|class)\s+([A-Z][A-Za-z0-9_]*)/g)) {
    disponiveis.add(m[1]);
  }
  return [...usados].filter(u => !disponiveis.has(u));
}

describe('componentes usados em JSX estao importados', () => {
  const arquivos = arquivosJsx(RAIZ);

  it('encontra os arquivos do projeto', () => {
    expect(arquivos.length).toBeGreaterThan(3);
  });

  it.each(arquivos.map(a => [path.relative(RAIZ, a), a]))('%s', (_nome, caminho) => {
    expect(naoDefinidos(fs.readFileSync(caminho, 'utf8'))).toEqual([]);
  });

  it('a propria checagem detecta um componente faltando', () => {
    // Sem este caso, um erro na deteccao faria todos os arquivos "passarem".
    const falso = `import React from 'react';\nexport const A = () => <Fantasma />;`;
    expect(naoDefinidos(falso)).toEqual(['Fantasma']);
  });
});
