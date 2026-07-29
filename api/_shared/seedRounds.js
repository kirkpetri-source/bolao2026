// Semeia as rodadas de um bolão novo copiando de um que já as tem.
//
// O cron sync-rounds busca na API e roda uma vez por dia, de madrugada. Um bolão
// criado depois disso ficava sem nenhuma rodada até o dia seguinte — ou seja, o
// organizador terminava o cadastro e encontrava um painel vazio, sem ter o que
// abrir para os participantes. Copiar de outro tenant resolve na hora e sem
// gastar chamada de API, porque os jogos do Brasileirão são os mesmos para todos.
import { DEFAULT_TENANT_ID } from './tenant.js';

// Rodadas já encerradas não são copiadas: viram fantasma no bolão novo, sem
// palpite nenhum, e o placar de jogo adiado que a API não tem as deixa presas
// em "em andamento" para sempre.
const STATUS_COPIAVEIS = ['upcoming', 'open'];

// Só replica o que comprovadamente veio da API. O painel permite criar rodada à
// mão, e o bolão de origem tem rodadas assim — copiá-las plantaria no bolão novo
// jogos que não existem no Brasileirão, que o sync diário nunca atualizaria
// (ele casa pelo apiRoundNumber) e que ficariam órfãos para sempre.
function veioDaApi(r) {
  return !!r.autoSyncedAt
    && Number.isFinite(Number(r.apiRoundNumber))
    && Array.isArray(r.matches) && r.matches.length > 0;
}

export async function seedRoundsForTenant(db, tenantId) {
  const jaTem = await db.collection('rounds').where('tenantId', '==', tenantId).limit(1).get();
  if (!jaTem.empty) return { criadas: 0, motivo: 'o bolão já tem rodadas' };

  // Fonte preferencial é o bolão original; se ele estiver vazio, usa o tenant
  // com mais rodadas — assim a semeadura não depende de um bolão específico.
  let fonte = await db.collection('rounds').where('tenantId', '==', DEFAULT_TENANT_ID).get();
  if (fonte.empty) {
    const todas = await db.collection('rounds').get();
    const porTenant = {};
    todas.docs.forEach(d => {
      const t = d.data().tenantId;
      if (!t || t === tenantId) return;
      (porTenant[t] = porTenant[t] || []).push(d);
    });
    const melhor = Object.values(porTenant).sort((a, b) => b.length - a.length)[0];
    if (!melhor) return { criadas: 0, motivo: 'nenhum bolão tem rodadas para copiar' };
    fonte = { docs: melhor };
  }

  const copiaveis = fonte.docs
    .map(d => d.data())
    .filter(r => STATUS_COPIAVEIS.includes(r.status) && veioDaApi(r))
    .sort((a, b) => (a.number || 0) - (b.number || 0));

  if (!copiaveis.length) return { criadas: 0, motivo: 'não há rodadas oficiais em aberto para copiar' };

  // Lotes de 400 para ficar abaixo do limite de 500 operações do Firestore.
  let criadas = 0;
  for (let i = 0; i < copiaveis.length; i += 400) {
    const lote = db.batch();
    for (const r of copiaveis.slice(i, i + 400)) {
      lote.set(db.collection('rounds').doc(), {
        tenantId,
        number: r.number,
        apiRoundNumber: r.apiRoundNumber || r.number,
        name: r.name || `Rodada ${r.number}`,
        status: r.status,
        matches: r.matches || [],
        closeAt: r.closeAt || null,
        // Notificações começam zeradas: quem acabou de criar o bolão não deve
        // receber aviso de abertura de rodada que aconteceu antes dele existir.
        notificacaoAberturaEnviada: r.status !== 'upcoming',
        alertaFaltando1hEnviado: false,
        notificacaoFechamentoEnviada: false,
        resultadoCalculado: false,
        resultSentToGroup: false,
        createdAt: new Date(),
      });
      criadas++;
    }
    await lote.commit();
  }

  return { criadas, motivo: null };
}
