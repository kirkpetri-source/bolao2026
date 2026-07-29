import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// O vercel.json tem schema estrito: qualquer propriedade fora do previsto faz o
// deploy falhar inteiro ("should NOT have additional property"). Como o erro so
// aparece no deploy, e nao no build nem nos testes, um commit pode ir para o
// GitHub e so entao descobrir que nao sobe. Aconteceu com um campo "comment".
const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'vercel.json'), 'utf8'));

const CHAVES_DE_HEADER = ['source', 'headers', 'has', 'missing'];

describe('vercel.json', () => {
  it('so usa propriedades validas nas regras de header', () => {
    for (const regra of cfg.headers || []) {
      const invalidas = Object.keys(regra).filter(k => !CHAVES_DE_HEADER.includes(k));
      expect(invalidas, `regra ${regra.source}`).toEqual([]);
    }
  });

  it('cada header tem key e value', () => {
    for (const regra of cfg.headers || []) {
      for (const h of regra.headers || []) {
        expect(Object.keys(h).sort()).toEqual(['key', 'value']);
      }
    }
  });

  it('o index.html nao pode ser guardado em cache', () => {
    // E ele que aponta para o bundle com hash: se ficar em cache, o navegador
    // segue carregando a versao antiga do sistema depois de cada deploy.
    const raiz = (cfg.headers || []).find(r => r.source === '/');
    const cc = raiz?.headers?.find(h => h.key === 'Cache-Control')?.value || '';
    expect(cc).toContain('no-store');
  });

  it('os assets com hash podem ser guardados para sempre', () => {
    const assets = (cfg.headers || []).find(r => r.source === '/assets/(.*)');
    const cc = assets?.headers?.find(h => h.key === 'Cache-Control')?.value || '';
    expect(cc).toContain('immutable');
  });

  it('os crons apontam para rotas existentes', () => {
    for (const c of cfg.crons || []) {
      const arquivo = path.resolve(__dirname, '..', c.path.replace(/^\//, '') + '.js');
      expect(fs.existsSync(arquivo), `${c.path} sem arquivo em ${arquivo}`).toBe(true);
    }
  });
});
