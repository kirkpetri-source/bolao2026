// Conexão de WhatsApp por tenant (Evolution API multi-instância).
// Cada bolão ganha uma instância própria no servidor Evolution (nome = slug do
// tenant); o organizador conecta o número dele escaneando o QR Code no painel.
//
// Ações (POST { idToken, tenantId, action }):
//  - status:     estado da conexão (+ número conectado, quando houver)
//  - connect:    cria a instância se não existir e retorna o QR Code
//  - disconnect: desloga o número (permite conectar outro)
//
// Autorização: owner do tenant ou admin global. A chave GLOBAL do Evolution vem
// de EVOLUTION_GLOBAL_APIKEY (env) ou do settings do tenant padrão (fallback);
// ela nunca é exposta ao cliente — a instância do tenant recebe um token próprio.
import crypto from 'crypto';
import https from 'https';
import axios from 'axios';
import { getAdminAuth, getAdminDb } from '../_shared/firebaseAdmin.js';
import { DEFAULT_TENANT_ID } from '../_shared/tenant.js';

const verifyTls = process.env.EVOLUTION_VERIFY_TLS === 'true';
const agent = new https.Agent({ rejectUnauthorized: verifyTls });

function api(base, apikey) {
  return axios.create({
    baseURL: base,
    headers: { 'Content-Type': 'application/json', apikey },
    httpsAgent: agent,
    timeout: 20000,
    validateStatus: () => true, // trata status manualmente
  });
}

// Estado da instância; null quando ela não existe.
async function getState(ev, name) {
  const r = await ev.get(`/instance/connectionState/${encodeURIComponent(name)}`);
  if (r.status === 404) return null;
  if (r.status >= 400) throw new Error(`connectionState HTTP ${r.status}`);
  return r.data?.instance?.state || r.data?.state || 'close';
}

// JIDs brasileiros costumam vir sem o nono dígito (556499555364). O número
// gravado vira o destino das notificações do organizador em bolao-engine, então
// precisa sair daqui no formato de celular completo.
function normalizeBrMobile(digits) {
  const m = /^55(\d{2})([6-9]\d{7})$/.exec(digits);
  return m ? `55${m[1]}9${m[2]}` : digits;
}

// Número conectado (ownerJid) — formatos variam entre versões do Evolution.
async function getOwnerNumber(ev, name) {
  const r = await ev.get(`/instance/fetchInstances?instanceName=${encodeURIComponent(name)}`);
  if (r.status >= 400) return '';
  const list = Array.isArray(r.data) ? r.data : (r.data?.instances || []);
  const inst = list.find(i => (i.name || i.instanceName || i.instance?.instanceName) === name) || list[0];
  const jid = inst?.ownerJid || inst?.owner || inst?.instance?.owner || '';
  return normalizeBrMobile(String(jid).split('@')[0].replace(/\D/g, ''));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    // `phone` liga o modo código de pareamento: no celular ninguém consegue
    // escanear o próprio QR Code, então o WhatsApp aceita digitar um código de
    // 8 caracteres em "Conectar com número de telefone".
    const { idToken, tenantId, action, phone } = req.body || {};
    if (!idToken || !tenantId || !['status', 'connect', 'disconnect'].includes(action)) {
      return res.status(400).json({ error: 'Parâmetros: idToken, tenantId, action (status|connect|disconnect)' });
    }
    const numero = String(phone || '').replace(/\D/g, '');
    if (phone && numero.length < 12) {
      return res.status(400).json({ error: 'Informe o número com DDI e DDD, por exemplo 5564999998888.' });
    }

    const auth = getAdminAuth();
    const db = getAdminDb();

    let decoded;
    try { decoded = await auth.verifyIdToken(idToken); }
    catch { return res.status(401).json({ error: 'Token inválido' }); }

    const callerSnap = await db.collection('users').doc(decoded.uid).get();
    const isGlobalAdmin = callerSnap.exists && callerSnap.data().isAdmin === true;
    if (!isGlobalAdmin) {
      const mem = await db.collection('tenants').doc(tenantId).collection('members').doc(decoded.uid).get();
      if (!mem.exists || mem.data().role !== 'owner') {
        return res.status(403).json({ error: 'Ação restrita ao dono do bolão' });
      }
    }

    // Config do servidor Evolution (plataforma). O link não é sensível e pode
    // vir do settings do tenant padrão como fallback, mas a CHAVE GLOBAL de
    // administração (AUTHENTICATION_API_KEY do servidor Evolution) só existe
    // em EVOLUTION_GLOBAL_APIKEY — é diferente do token por-instância salvo em
    // settings.devolution.token, que só autoriza envio de mensagens daquela
    // instância específica, não a criação de instâncias novas.
    let link = (process.env.EVOLUTION_LINK || '').trim();
    if (!link) {
      const defSnap = await db.collection('settings').where('tenantId', '==', DEFAULT_TENANT_ID).limit(1).get();
      link = defSnap.empty ? '' : String(defSnap.docs[0].data().devolution?.link || '').trim();
    }
    const globalKey = (process.env.EVOLUTION_GLOBAL_APIKEY || '').trim();
    if (!link || !globalKey) {
      return res.status(503).json({ error: 'Servidor de WhatsApp não configurado na plataforma (EVOLUTION_GLOBAL_APIKEY ausente)' });
    }
    link = link.replace(/\/+$/, '');
    const ev = api(link, globalKey);

    // Nome da instância = slug do tenant (já é [a-z0-9-]).
    const name = String(tenantId).toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const settingsSnap = await db.collection('settings').where('tenantId', '==', tenantId).limit(1).get();
    const settingsRef = settingsSnap.empty ? null : settingsSnap.docs[0].ref;

    if (action === 'status') {
      const state = await getState(ev, name);
      if (state === 'open') {
        const number = await getOwnerNumber(ev, name);
        // Número conectado alimenta as notificações automáticas deste tenant.
        if (number && settingsRef) {
          await settingsRef.update({ 'whatsapp.number': number }).catch(() => {});
        }
        return res.status(200).json({ state, number });
      }
      return res.status(200).json({ state: state || 'not_created' });
    }

    if (action === 'disconnect') {
      const r = await ev.delete(`/instance/logout/${encodeURIComponent(name)}`);
      if (r.status >= 400 && r.status !== 404) {
        return res.status(502).json({ error: `Falha ao desconectar (HTTP ${r.status})` });
      }
      if (settingsRef) await settingsRef.update({ 'whatsapp.number': '' }).catch(() => {});
      return res.status(200).json({ state: 'close' });
    }

    // action === 'connect'
    let state = await getState(ev, name);
    if (state === null) {
      // Instância nova, com token próprio (a chave global nunca vai para o tenant).
      const instToken = crypto.randomBytes(24).toString('hex');
      const r = await ev.post('/instance/create', {
        instanceName: name,
        token: instToken,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
      });
      if (r.status >= 400) {
        return res.status(502).json({ error: `Falha ao criar instância (HTTP ${r.status})`, detail: r.data?.response?.message || r.data?.message || null });
      }
      // Grava a config da instância no settings do tenant — a partir daqui os
      // envios automáticos (engine/lembretes) usam a instância própria.
      if (settingsRef) {
        await settingsRef.update({ devolution: { link, instanceName: name, token: instToken } });
      }
      // Instância recém-criada com número: pede o código de pareamento em vez
      // do QR, que é inútil quando o organizador está no próprio celular.
      if (numero) {
        const pc = await ev.get(`/instance/connect/${encodeURIComponent(name)}?number=${numero}`);
        const codigo = pc.data?.pairingCode || pc.data?.code || null;
        if (codigo) return res.status(200).json({ state: 'connecting', pairingCode: codigo });
      }
      const qr = r.data?.qrcode?.base64 || null;
      if (qr) return res.status(200).json({ state: 'connecting', qr });
      state = 'close';
    }

    if (state === 'open') {
      const number = await getOwnerNumber(ev, name);
      return res.status(200).json({ state, number });
    }

    // Instância existe mas está desconectada: gera QR novo — ou o código de
    // pareamento, quando o organizador informou o número.
    const rota = `/instance/connect/${encodeURIComponent(name)}${numero ? `?number=${numero}` : ''}`;
    const r = await ev.get(rota);
    if (r.status >= 400) {
      return res.status(502).json({ error: `Falha ao conectar (HTTP ${r.status})` });
    }
    if (numero) {
      const codigo = r.data?.pairingCode || r.data?.code || null;
      if (codigo) return res.status(200).json({ state: 'connecting', pairingCode: codigo });
      return res.status(200).json({ state: 'connecting', pairingCode: null, note: 'Código indisponível — tente novamente em instantes' });
    }
    const qr = r.data?.base64 || r.data?.qrcode?.base64 || null;
    if (!qr) return res.status(200).json({ state: 'connecting', qr: null, note: 'QR indisponível — tente novamente em instantes' });
    return res.status(200).json({ state: 'connecting', qr });
  } catch (err) {
    console.error('evolution/instance:', err.message);
    return res.status(500).json({ error: 'Erro na conexão com o servidor de WhatsApp' });
  }
}
