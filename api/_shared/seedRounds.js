// Semeia as rodadas de um bolão novo copiando de um que já as tem.
//
// O cron sync-rounds busca na API e roda uma vez por dia, de madrugada. Um bolão
// criado depois disso ficava sem nenhuma rodada até o dia seguinte — ou seja, o
// organizador terminava o cadastro e encontrava um painel vazio, sem ter o que
// abrir para os participantes. Copiar de outro tenant resolve na hora e sem
// gastar chamada de API, porque os jogos do Brasileirão são os mesmos para todos.
import { DEFAULT_TENANT_ID } from './tenant.js';

const DIAS_PARA_ABRIR = 5;

// Data do primeiro jogo da rodada. É ela, e não o status guardado, que decide
// se a rodada ainda pode receber palpite.
function primeiroJogoEm(r) {
  const datas = (r.matches || []).map(m => m.date).filter(Boolean).map(d => new Date(d).getTime())
    .filter(t => Number.isFinite(t));
  return datas.length ? Math.min(...datas) : null;
}

// Status recalculado no momento da cópia. Confiar no status do bolão de origem
// seria perigoso: ele só muda quando o cron passa, então uma rodada pode estar
// gravada como "open" com os jogos já rolando. Copiada assim, o bolão novo
// aceitaria palpite com o resultado acontecendo na tela.
function statusNaCopia(r, agora) {
  const inicio = primeiroJogoEm(r);
  if (inicio === null) return null;                    // sem data: não dá para garantir, não copia
  if (inicio <= agora) return 'em_andamento';          // já começou: não vai
  const horas = (inicio - agora) / 36e5;
  return horas <= DIAS_PARA_ABRIR * 24 ? 'open' : 'upcoming';
}

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
  if (!jaTem.empty) return { criadas: 0, emAndamento: [], motivo: 'o bolão já tem rodadas' };

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
    if (!melhor) return { criadas: 0, emAndamento: [], motivo: 'nenhum bolão tem rodadas para copiar' };
    fonte = { docs: melhor };
  }

  const agora = Date.now();
  const oficiais = fonte.docs.map(d => d.data()).filter(veioDaApi);

  const emAndamento = [];
  const copiaveis = [];
  for (const r of oficiais) {
    const st = statusNaCopia(r, agora);
    if (st === 'em_andamento') { emAndamento.push(r.number); continue; }
    if (st) copiaveis.push({ ...r, statusCalculado: st });
  }
  copiaveis.sort((a, b) => (a.number || 0) - (b.number || 0));
  emAndamento.sort((a, b) => a - b);

  if (!copiaveis.length) {
    return { criadas: 0, emAndamento, motivo: 'não há rodadas futuras para trazer' };
  }

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
        status: r.statusCalculado,
        matches: r.matches || [],
        closeAt: r.closeAt || null,
        // Notificações começam zeradas: quem acabou de criar o bolão não deve
        // receber aviso de abertura de rodada que aconteceu antes dele existir.
        notificacaoAberturaEnviada: r.statusCalculado !== 'upcoming',
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

  return { criadas, emAndamento, motivo: null };
}
