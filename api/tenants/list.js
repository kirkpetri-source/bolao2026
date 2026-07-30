// Lista pública de bolões, para quem perdeu o link do organizador.
//
// Endpoint em vez de consulta direta ao Firestore porque a decisão de QUEM
// aparece é do servidor: bolão bloqueado por falta de pagamento não deve
// receber gente nova, e o organizador pode não querer o bolão dele numa
// lista aberta.
//
// Só devolve nome e endereço. Nada de participantes, valores ou contato.
import { getAdminDb } from '../_shared/firebaseAdmin.js';
import { DEFAULT_TENANT_ID } from '../_shared/tenant.js';
import { isBlocked } from '../_shared/subscription.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const db = getAdminDb();
    const snap = await db.collection('tenants').get();

    // ?slug= é o bolão do convite. Ele precisa aparecer para quem chegou pelo
    // link MESMO estando fora da lista pública: bolão de empresa ou de família
    // costuma ser fechado, e sem isso o convidado não teria como se cadastrar.
    // Bloqueado continua fora, inclusive aqui.
    const convite = String(req.query?.slug || '').trim().toLowerCase();
    let convidado = null;

    const boloes = [];
    for (const d of snap.docs) {
      const t = d.data();

      if (convite && d.id === convite && !isBlocked(t.subscription)) {
        convidado = { slug: d.id, nome: t.name || d.id };
      }

      // O bolão da própria plataforma não é produto de ninguém.
      if (d.id === DEFAULT_TENANT_ID) continue;
      // Bloqueado não recebe gente nova: o participante se cadastraria e não
      // conseguiria palpitar, culpando o sistema.
      if (isBlocked(t.subscription)) continue;
      // O organizador pode tirar o bolão da lista (bolão fechado, de empresa,
      // de família). Ausente = aparece, porque é o comportamento esperado.
      if (t.listadoPublicamente === false) continue;

      boloes.push({ slug: d.id, nome: t.name || d.id });
    }

    boloes.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

    // O convidado entra na lista quando não estava nela, para o formulário de
    // cadastro conseguir pré-selecioná-lo.
    if (convidado && !boloes.some(b => b.slug === convidado.slug)) {
      boloes.unshift(convidado);
    }

    // Lista muda pouco; cache curto alivia a origem sem deixar bolão novo
    // invisível por muito tempo.
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=120');
    return res.status(200).json({ boloes, convidado });
  } catch (err) {
    console.error('tenants/list:', err.message);
    return res.status(500).json({ error: 'Erro ao listar os bolões' });
  }
}
