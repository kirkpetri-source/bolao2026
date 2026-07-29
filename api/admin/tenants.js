// Painel do super-admin: visão de todos os bolões e suas mensalidades.
// Passa por endpoint porque a coleção /tenants não é listável pelo cliente
// (firestore.rules: allow list: if false) — e nem deveria ser.
import { getAdminAuth, getAdminDb } from '../_shared/firebaseAdmin.js';
import { DEFAULT_TENANT_ID } from '../_shared/tenant.js';
import { STATUS, evaluateStatus, accessEndsAt, trialSubscription } from '../_shared/subscription.js';
import { mascaraTaxId } from '../_shared/taxid.js';
import { isPlatformAdmin } from '../_shared/roles.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { idToken } = req.body || {};
    if (!idToken) return res.status(400).json({ error: 'Parâmetro: idToken' });

    const db = getAdminDb();

    let decoded;
    try { decoded = await getAdminAuth().verifyIdToken(idToken); }
    catch { return res.status(401).json({ error: 'Token inválido' }); }

    // Só quem opera a plataforma. Dono de bolão não enxerga a carteira alheia.
    if (!(await isPlatformAdmin(db, decoded))) {
      return res.status(403).json({ error: 'Restrito ao administrador da plataforma' });
    }

    const snap = await db.collection('tenants').get();
    const agora = Date.now();

    const boloes = snap.docs.map(d => {
      const t = d.data();
      const sub = t.subscription || (d.id === DEFAULT_TENANT_ID ? null : trialSubscription(agora));
      const status = d.id === DEFAULT_TENANT_ID ? 'plataforma' : evaluateStatus(sub, agora);
      return {
        id: d.id,
        nome: t.name || d.id,
        email: t.ownerEmail || '',
        whatsapp: t.ownerWhatsapp || '',
        status,
        recorrente: !!sub?.recurring,
        documento: sub?.taxID ? mascaraTaxId(sub.taxID) : '',
        precoCentavos: sub?.priceCents || 0,
        acessoAte: accessEndsAt(sub) || null,
        ultimoPagamento: sub?.lastChargeId || null,
        criadoEm: t.createdAt?.toMillis?.() ?? null,
      };
    });

    // MRR conta só quem está pagando de fato: bolão em teste ainda não é receita,
    // e contá-lo inflaria o número justamente no começo, quando ele engana mais.
    const pagantes = boloes.filter(b => b.status === STATUS.ACTIVE);
    const mrrCentavos = pagantes.reduce((s, b) => s + b.precoCentavos, 0);

    const resumo = {
      total: boloes.filter(b => b.status !== 'plataforma').length,
      ativos: pagantes.length,
      emTeste: boloes.filter(b => b.status === STATUS.TRIAL).length,
      vencidos: boloes.filter(b => b.status === STATUS.OVERDUE).length,
      bloqueados: boloes.filter(b => b.status === STATUS.BLOCKED).length,
      recorrentes: boloes.filter(b => b.recorrente).length,
      mrrCentavos,
    };

    boloes.sort((a, b) => (a.acessoAte || 0) - (b.acessoAte || 0));
    return res.status(200).json({ resumo, boloes });
  } catch (err) {
    console.error('admin/tenants:', err.message);
    return res.status(500).json({ error: 'Erro ao carregar os bolões' });
  }
}
