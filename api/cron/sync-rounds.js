import { db, getSettings, sendWhatsApp, formatPhone } from '../_shared/firebase.js';
import { getRoundFixtures, normalizeName } from '../services/footballApi.js';
import { collection, getDocs, addDoc, updateDoc, doc, serverTimestamp, query, where } from '../_shared/firestore.js';
import { listTenants } from '../_shared/tenant.js';

const TOTAL_ROUNDS = 38;

// TheSportsDB usa textos livres: "Postponed", "Match Postponed", "PPD", e
// tambem "Cancelled"/"Abandoned" para jogos que nao serao concluidos.
export function ehAdiado(status) {
  const s = String(status || '').toLowerCase();
  return /postpon|adiad|ppd|cancel|abandon|suspend/.test(s);
}

// Quantas horas a data mudou entre o que estava gravado e o que a API diz.
export function horasDeDiferenca(antes, depois) {
  const a = new Date(antes || 0).getTime();
  const d = new Date(depois || 0).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(d) || !antes || !depois) return 0;
  return Math.abs(d - a) / 36e5;
}

function findTeamId(teamNormalized, teamsMap) {
  if (teamsMap[teamNormalized]) return teamsMap[teamNormalized];
  // Fallback: busca parcial
  for (const [key, id] of Object.entries(teamsMap)) {
    if (key.includes(teamNormalized) || teamNormalized.includes(key)) return id;
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const forceRound = req.query.round ? parseInt(req.query.round, 10) : null;
  const logs = [];
  const alteracoes = [];

  try {
    // Carregar times do Firestore para resolver IDs (catálogo global)
    const teamsSnap = await getDocs(collection(db, 'teams'));
    const teamsMap = {}; // normalizedName → id
    teamsSnap.docs.forEach(d => {
      teamsMap[d.data().normalizedName] = d.id;
    });

    // Rodadas existentes agrupadas por tenant: byTenant[tid][numero] = rodada
    const tenants = await listTenants();
    const roundsSnap = await getDocs(collection(db, 'rounds'));
    const byTenant = {};
    roundsSnap.docs.forEach(d => {
      const data = d.data();
      const n = data.apiRoundNumber || data.number;
      if (!n || !data.tenantId) return;
      if (!byTenant[data.tenantId]) byTenant[data.tenantId] = {};
      byTenant[data.tenantId][n] = { id: d.id, ...data };
    });

    // Modo "proximas": varre so as rodadas que ainda podem mudar de data — as
    // que estao abertas ou por vir nas proximas 2 semanas. E o que permite
    // rodar de hora em hora sem estourar o limite da API, porque data de jogo
    // muda no meio do dia e uma varredura diaria descobria tarde demais.
    const soProximas = req.query?.near === '1';
    let roundsToSync;
    if (forceRound) {
      roundsToSync = [forceRound];
    } else if (soProximas) {
      const limite = Date.now() + 14 * 24 * 60 * 60 * 1000;
      const numeros = new Set();
      roundsSnap.docs.forEach(d => {
        const r = d.data();
        if (!['upcoming', 'open', 'closed'].includes(r.status)) return;
        const n = r.apiRoundNumber || r.number;
        if (!n) return;
        const datas = (r.matches || []).map(m => new Date(m.date).getTime()).filter(Number.isFinite);
        // Inclui rodada ja fechada cujo jogo ainda nao aconteceu: e exatamente
        // o caso do adiamento, que so aparece depois do fechamento.
        if (datas.some(t => t <= limite && t >= Date.now() - 7 * 24 * 60 * 60 * 1000)) numeros.add(n);
      });
      roundsToSync = [...numeros].sort((a, b) => a - b);
      logs.push(`Modo próximas: ${roundsToSync.length} rodada(s) — ${roundsToSync.join(', ') || 'nenhuma'}`);
    } else {
      roundsToSync = Array.from({ length: TOTAL_ROUNDS }, (_, i) => i + 1);
    }
    let created = 0, updated = 0, errors = 0;

    for (const roundNum of roundsToSync) {
      try {
        // Uma única busca na API por rodada; o upsert replica para cada tenant
        const fixtures = await getRoundFixtures(roundNum);
        if (!fixtures.length) continue;

        const matches = fixtures.map((f, idx) => {
          const homeTeamId = findTeamId(f.homeTeamNormalized, teamsMap);
          const awayTeamId = findTeamId(f.awayTeamNormalized, teamsMap);
          return {
            id: idx + 1,
            apiEventId: f.apiEventId,
            homeTeamId: homeTeamId || null,
            homeTeamName: f.homeTeamName,
            homeTeamApiId: f.homeTeamApiId,
            homeTeamLogo: f.homeTeamLogo,
            awayTeamId: awayTeamId || null,
            awayTeamName: f.awayTeamName,
            awayTeamApiId: f.awayTeamApiId,
            awayTeamLogo: f.awayTeamLogo,
            date: f.date,
            homeScore: f.homeScore,
            awayScore: f.awayScore,
            finished: f.finished,
            // Sem guardar o status, um jogo adiado fica indistinguivel de um
            // que ainda vai acontecer: nunca ganha placar, nunca "termina", e
            // a rodada fica em andamento para sempre.
            apiStatus: f.status || null,
            postponed: ehAdiado(f.status),
          };
        });

        // Ordenar matches por data para determinar o 1º jogo (usado no closeAt)
        const sorted = [...matches].sort((a, b) => new Date(a.date) - new Date(b.date));
        const firstMatchDate = sorted[0]?.date;
        // Fechar 5 minutos antes do 1º jogo
        const closeAt = firstMatchDate
          ? new Date(new Date(firstMatchDate).getTime() - 5 * 60 * 1000).toISOString()
          : null;

        // Determina status correto com base nas datas reais dos jogos
        const smartStatus = (() => {
          if (!firstMatchDate) return 'upcoming';
          const first = new Date(firstMatchDate);
          const now = new Date();
          const hoursToFirst = (first - now) / (1000 * 60 * 60);
          if (hoursToFirst < 0) return 'closed';        // 1º jogo já ocorreu
          if (hoursToFirst <= 5 * 24) return 'open';    // dentro de 5 dias → aberta
          return 'upcoming';
        })();

        for (const tenant of tenants) {
          const existing = byTenant[tenant.id]?.[roundNum];
          // Rodada já encerrada e que o tenant nunca teve: não criar. Um bolão
          // novo começa na rodada atual — rodadas passadas viram fantasmas
          // ("em andamento" eterno quando a API não tem placar de jogo adiado)
          // e histórico vazio sem palpites.
          if (!existing && smartStatus === 'closed') continue;
          if (existing) {
            // O que mudou de data desde a ultima sincronizacao. Precisa ser
            // detectado ANTES de sobrescrever os jogos, senao a mudanca some.
            const anteriores = {};
            (existing.matches || []).forEach(m => { anteriores[m.apiEventId || m.id] = m; });
            const mudancas = [];
            for (const m of matches) {
              const antes = anteriores[m.apiEventId || m.id];
              if (!antes) continue;
              const horas = horasDeDiferenca(antes.date, m.date);
              const virouAdiado = m.postponed && !antes.postponed;
              if (horas >= 1 || virouAdiado) {
                mudancas.push({ jogo: `${m.homeTeamName} x ${m.awayTeamName}`, horas, adiado: !!m.postponed, de: antes.date, para: m.date });
              }
            }

            // Rodada finalizada nao se mexe. Ja a FECHADA continua sendo
            // atualizada de propósito: adiamento costuma ser anunciado depois
            // do fechamento, e sem isso o sistema nunca saberia da nova data.
            const podeAtualizar = ['upcoming', 'open', 'closed'].includes(existing.status);
            if (podeAtualizar) {
              let statusUpdate = {};
              if (existing.status === 'upcoming' && smartStatus !== 'upcoming') {
                statusUpdate = { status: smartStatus, notificacaoAberturaEnviada: smartStatus !== 'upcoming', alertaFaltando1hEnviado: smartStatus === 'closed' };
              } else if (existing.status === 'closed' && smartStatus === 'open') {
                // Todos os jogos foram adiados para o futuro: a rodada volta a
                // aceitar palpite. So acontece quando NENHUM jogo comecou —
                // smartStatus so devolve 'open' se o primeiro jogo ainda vem.
                statusUpdate = { status: 'open', notificacaoFechamentoEnviada: false, alertaFaltando1hEnviado: false };
                logs.push(`[${tenant.id}] Rodada ${roundNum} REABERTA: todos os jogos foram remarcados`);
              }

              // Nao sobrescreve placar ja apurado com o que a TheSportsDB
              // devolve — quem manda no placar e o sync-scores.
              const mesclados = matches.map(m => {
                const antes = anteriores[m.apiEventId || m.id];
                if (!antes) return m;
                const manterPlacar = antes.finished || antes.homeScore != null;
                return manterPlacar
                  ? { ...m, homeScore: antes.homeScore, awayScore: antes.awayScore, finished: antes.finished, matchStatus: antes.matchStatus }
                  : m;
              });

              await updateDoc(doc(db, 'rounds', existing.id), {
                matches: mesclados,
                closeAt,
                autoSyncedAt: serverTimestamp(),
                ...(mudancas.length ? { ultimaMudancaDeData: { em: new Date().toISOString(), jogos: mudancas } } : {}),
                ...statusUpdate
              });
              updated++;
              if (mudancas.length) {
                alteracoes.push({ tenantId: tenant.id, roundNum, mudancas });
                logs.push(`[${tenant.id}] Rodada ${roundNum}: ${mudancas.length} jogo(s) com data alterada`);
              } else {
                logs.push(`[${tenant.id}] Rodada ${roundNum} atualizada`);
              }
            }
          } else {
            await addDoc(collection(db, 'rounds'), {
              tenantId: tenant.id,
              number: roundNum,
              apiRoundNumber: roundNum,
              name: `Rodada ${roundNum}`,
              status: smartStatus,
              matches,
              closeAt,
              notificacaoAberturaEnviada: smartStatus !== 'upcoming',
              alertaFaltando1hEnviado: smartStatus === 'closed',
              notificacaoFechamentoEnviada: smartStatus === 'closed',
              resultadoCalculado: false,
              resultSentToGroup: false,
              autoSyncedAt: serverTimestamp(),
              createdAt: serverTimestamp()
            });
            created++;
            logs.push(`[${tenant.id}] Rodada ${roundNum} criada com status "${smartStatus}" (${matches.length} jogos)`);
          }
        }

        // Pausa para respeitar rate limit do TheSportsDB
        await new Promise(r => setTimeout(r, 800));
      } catch (err) {
        errors++;
        logs.push(`Erro na rodada ${roundNum}: ${err.message}`);
      }
    }

    // Avisa o organizador: mudanca de data quebra a expectativa de quem ja
    // palpitou, e ele precisa saber antes dos participantes reclamarem.
    const porTenant = {};
    for (const a of alteracoes) (porTenant[a.tenantId] = porTenant[a.tenantId] || []).push(a);
    for (const [tid, itens] of Object.entries(porTenant)) {
      try {
        const settings = await getSettings(tid);
        const destino = formatPhone(settings?.whatsapp?.number || '');
        if (!destino) continue;
        const linhas = itens.flatMap(i => i.mudancas.map(m => {
          const quando = m.para ? new Date(m.para).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'sem data';
          return m.adiado
            ? `• R${i.roundNum} — ${m.jogo}: ADIADO`
            : `• R${i.roundNum} — ${m.jogo}: agora ${quando}`;
        }));
        const texto = [
          '📅 *Mudança na tabela*',
          '',
          'A CBF remarcou jogo(s) do seu bolão:',
          '',
          ...linhas,
          '',
          'O sistema já ajustou o horário de fechamento das rodadas afetadas.',
        ].join(String.fromCharCode(10));
        await sendWhatsApp(destino, texto, settings);
        logs.push(`[${tid}] Organizador avisado sobre ${linhas.length} mudança(s)`);
      } catch (e) {
        logs.push(`[${tid}] Falha ao avisar sobre mudança de data: ${e.message}`);
      }
    }

    logs.push(`Resumo: Tenants=${tenants.length} | Criadas=${created} | Atualizadas=${updated} | Erros=${errors} | Mudanças de data=${alteracoes.length}`);
    return res.status(200).json({ success: true, logs, alteracoes });
  } catch (err) {
    console.error('sync-rounds error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
}
