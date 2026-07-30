import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Trophy, Users, Calendar, Clock, TrendingUp, LogOut, Eye, EyeOff, Plus, Edit2, Trash2, Upload, ExternalLink, X, UserPlus, Target, Award, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Check, Key, DollarSign, CheckCircle, XCircle, AlertCircle, FileText, Download, Store, Filter, Loader2, Megaphone, Send, Search, Bell, Copy, RefreshCcw, History, Moon, Sun } from 'lucide-react';
import { collection, addDoc, updateDoc, deleteDoc, doc, setDoc, getDocs, getDoc, onSnapshot, serverTimestamp, query, where, orderBy, limit, writeBatch } from 'firebase/firestore';
import { jsPDF } from 'jspdf';
import axios from 'axios';
import { db, PUBLIC_CONFIG_ID, pickPublicConfig } from './firebase.js';
import { SERIE_A_2026_TEAMS } from './constants.js';
import { useApp } from './AppContext.js';
import { RulesCard, DarkToggle } from './components/shared.jsx';
import GuidedTour from './components/GuidedTour.jsx';
import { generateCartelaCode, fmtBRL, sortMatchesByDate, MATCH_FINISH_AFTER_MS, MATCH_IN_PROGRESS_STATUSES, isMatchEffectivelyFinished, getSafeLogo, markdownToHtml } from './utils/helpers.js';
import { MESSAGE_TEMPLATES, TEMPLATE_CATEGORIES, buildTemplateText as buildTemplateTextUtil, validateMessageTags, normalizeTags, compileTemplate } from './utils/messageTemplates.js';
import { getIdToken, authErrorMessage } from './authService.js';
import {
  isMatchPostponed, resumoDaRodada, matchCountsForScoring,
  isMatchManual, temJogoManual, jogosManuaisPendentes,
} from '../api/_shared/matchStatus.js';
import { calcPoints } from '../api/_shared/scoring.js';
import { CampoSenha } from './components/CampoSenha.jsx';
import { validaSenha, MIN_SENHA } from '../api/_shared/senha.js';
import { inviteUrl, inviteMessage } from './tenant.js';
import { STATUS, evaluateStatus, accessEndsAt, daysUntil } from '../api/_shared/subscription.js';
import { rateio, percentuaisDe, PADRAO_ESTABELECIMENTO_PCT } from '../api/_shared/rateio.js';

// Baixa automática das cartelas. Sem isso o organizador confere comprovante a
// comprovante no WhatsApp e marca cada um na mão — o que não escala e é onde
// mais aparece erro de conferência.
const RecebimentoAutomaticoCard = () => {
  const { settings, updateSettings, currentUser } = useApp();
  const [appId, setAppId] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState('');
  const [erro, setErro] = useState('');

  const ativo = !!settings?.woovi?.appId?.trim();
  const webhook = `${window.location.origin}/api/payments/woovi-webhook`;

  if (currentUser?.globalAdmin) return null; // já tem a aba Integrações

  const salvar = async (valor) => {
    setSalvando(true); setErro(''); setMsg('');
    try {
      await updateSettings({ 'woovi.appId': valor });
      setMsg(valor
        ? 'Recebimento automático ativado. Cadastre a URL do webhook na Woovi para a baixa acontecer sozinha.'
        : 'Recebimento automático desligado. Você volta a conferir os comprovantes na mão.');
      setAppId('');
    } catch (e) {
      setErro(e.message || 'Não foi possível salvar agora.');
    } finally {
      setSalvando(false);
    }
  };

  const copiarWebhook = async () => {
    try { await navigator.clipboard.writeText(webhook); setMsg('URL do webhook copiada.'); } catch {}
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-bold">Recebimento automático das cartelas</h3>
        <span className={`text-xs font-bold px-2 py-1 rounded-full ${ativo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
          {ativo ? 'AUTOMÁTICO' : 'MANUAL'}
        </span>
      </div>

      <p className="text-sm text-gray-600 mb-4">
        Hoje o participante paga no seu PIX e você confere o comprovante para dar baixa.
        Conectando uma conta Woovi, o sistema gera o QR Code do PIX, identifica o pagamento
        e <strong>dá baixa sozinho</strong>, sem você conferir comprovante.
      </p>

      {ativo ? (
        <>
          <div className="rounded-xl bg-green-50 border border-green-200 p-4 mb-4">
            <p className="text-sm text-green-800 font-semibold mb-1">Modo automático ligado</p>
            <p className="text-sm text-green-700">
              Confirme que a URL abaixo está cadastrada como webhook na sua conta Woovi,
              no evento <em>Cobrança paga</em>. Sem ela a cobrança é criada, mas a baixa
              não acontece sozinha.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <input readOnly value={webhook} onFocus={(e) => e.target.select()}
              className="v2-input flex-1 font-mono text-xs" />
            <button onClick={copiarWebhook} className="v2-btn-outline px-4 py-2.5 text-sm whitespace-nowrap">
              <Copy size={15} /> Copiar
            </button>
          </div>
          <button onClick={() => salvar('')} disabled={salvando}
            className="px-4 py-2 border border-red-300 text-red-600 rounded-lg text-sm disabled:opacity-60">
            Voltar para o modo manual
          </button>
        </>
      ) : (
        <>
          <div className="rounded-xl border border-gray-200 p-4 mb-4">
            <p className="text-sm font-semibold text-noite-800 mb-1">Como está hoje: modo manual</p>
            <p className="text-sm text-gray-600">
              O participante paga no seu PIX e manda o comprovante. Você confere e marca
              como pago no Financeiro. Funciona sem cadastro nenhum, mas dá trabalho e é
              onde mais aparece erro de conferência.
            </p>
          </div>

          <p className="text-sm font-semibold text-noite-800 mb-2">Para ativar o modo automático</p>
          <p className="text-sm text-gray-600 mb-3">
            É preciso ter uma conta na <strong>Woovi</strong>, que é quem identifica o
            pagamento. A conta é gratuita e o dinheiro continua caindo na sua chave PIX —
            a Woovi só avisa o sistema de que o pagamento entrou.
          </p>
          <ol className="text-sm text-gray-600 list-decimal pl-5 space-y-2 mb-4">
            <li>Acesse <strong>woovi.com</strong> e crie sua conta com o seu CNPJ ou CPF.</li>
            <li>Cadastre na Woovi a mesma <strong>chave PIX</strong> onde você quer receber as cartelas.</li>
            <li>No painel da Woovi, abra <strong>API / Integrações</strong> e gere uma <strong>API Key</strong>.</li>
            <li>
              Marque apenas as permissões <strong>criar cobrança</strong> e <strong>ler cobrança</strong>.
              Não marque saque, transferência, pagamento nem chave PIX — se essa chave vazar,
              quem a tiver não consegue mover o seu dinheiro.
            </li>
            <li>Copie a chave gerada e cole no campo abaixo.</li>
            <li>Depois de salvar, aparece aqui a URL do webhook. Volte à Woovi, abra <strong>Webhooks</strong> e cadastre essa URL no evento <em>Cobrança paga</em>.</li>
          </ol>

          <label className="v2-label">App ID da sua conta Woovi</label>
          <div className="relative mb-1">
            <input type={mostrar ? 'text' : 'password'} value={appId} onChange={(e) => setAppId(e.target.value)}
              placeholder="Q2xpZW50X0lk..." className="v2-input pr-10 font-mono text-sm" />
            <button onClick={() => setMostrar(!mostrar)} type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-noite-400">
              {mostrar ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <p className="text-xs text-gray-400 mb-4">
            A chave fica guardada só no seu bolão e nunca aparece para os participantes.
            Você pode voltar ao modo manual quando quiser.
          </p>
          <button onClick={() => salvar(appId.trim())} disabled={salvando || !appId.trim()}
            className="v2-btn-primary px-5 py-2.5 text-sm disabled:opacity-60">
            {salvando && <Loader2 size={15} className="animate-spin" />} Ativar recebimento automático
          </button>
        </>
      )}

      {erro && <p className="text-sm text-red-600 mt-3">{erro}</p>}
      {msg && <p className="text-sm text-green-700 mt-3">{msg}</p>}
    </div>
  );
};

// Convite do bolao: link pronto e mensagem pronta. E o ultimo passo antes de o
// bolao ganhar vida, entao precisa estar a um clique — nao escondido numa aba.
const ConviteCard = () => {
  const { tenantId, settings } = useApp();
  const [copiado, setCopiado] = useState('');
  const [listado, setListado] = useState(true);
  const [salvandoLista, setSalvandoLista] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'tenants', tenantId));
        // Ausente = aparece: é o comportamento esperado por quem acabou de criar.
        if (vivo && snap.exists()) setListado(snap.data().listadoPublicamente !== false);
      } catch { /* sem acesso: mantém o padrão */ }
    })();
    return () => { vivo = false; };
  }, [tenantId]);

  const alternarListagem = async (valor) => {
    setSalvandoLista(true);
    const anterior = listado;
    setListado(valor);
    try {
      const idToken = await getIdToken();
      const r = await fetch('/api/tenants/listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, tenantId, listado: valor }),
      });
      if (!r.ok) throw new Error('falhou');
    } catch {
      setListado(anterior);   // desfaz para a tela não mentir sobre o estado
    } finally {
      setSalvandoLista(false);
    }
  };

  const nome = settings?.brandName || 'Nosso bolão';
  const url = inviteUrl(tenantId);
  const mensagem = inviteMessage(nome, url);

  const copiar = async (texto, qual) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(qual);
      setTimeout(() => setCopiado(''), 2000);
    } catch { /* sem clipboard: o texto está visível para copiar à mão */ }
  };

  return (
    <div data-tour="convite" className="bg-white rounded-xl shadow-sm border p-6">
      <h3 className="text-lg font-bold mb-2">Convide seus participantes</h3>
      <p className="text-sm text-gray-600 mb-4">
        Quem abrir este link cai direto no cadastro do <strong>seu</strong> bolão.
      </p>

      <label className="v2-label">Link do seu bolão</label>
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <input type="text" readOnly value={url} onFocus={(e) => e.target.select()}
          className="v2-input flex-1 font-mono text-xs" />
        <button onClick={() => copiar(url, 'link')} className="v2-btn-outline px-4 py-2.5 text-sm whitespace-nowrap">
          <Copy size={15} /> {copiado === 'link' ? 'Copiado!' : 'Copiar link'}
        </button>
      </div>

      <label className="v2-label">Mensagem pronta para o grupo</label>
      <textarea readOnly value={mensagem} rows={7} onFocus={(e) => e.target.select()}
        className="v2-input w-full text-sm mb-3 resize-none" />

      <div className="flex flex-col sm:flex-row gap-2">
        <a href={`https://wa.me/?text=${encodeURIComponent(mensagem)}`} target="_blank" rel="noopener noreferrer"
          className="v2-btn-primary px-5 py-2.5 text-sm justify-center">
          <Send size={16} /> Enviar pelo WhatsApp
        </a>
        <button onClick={() => copiar(mensagem, 'msg')} className="v2-btn-outline px-5 py-2.5 text-sm">
          <Copy size={15} /> {copiado === 'msg' ? 'Copiada!' : 'Copiar mensagem'}
        </button>
      </div>

      {/* Quem perdeu o link acha o bolão na lista da página inicial. Bolão de
          empresa ou de família não deveria estar num catálogo aberto, então a
          escolha é do organizador. */}
      <label className="flex items-start gap-2.5 mt-5 pt-4 border-t text-sm text-gray-600 cursor-pointer select-none">
        <input type="checkbox" checked={listado} disabled={salvandoLista}
          onChange={(e) => alternarListagem(e.target.checked)}
          className="w-4 h-4 mt-0.5 accent-[#008542] flex-shrink-0" />
        <span>
          Mostrar meu bolão na lista pública da página inicial
          <span className="block text-xs text-gray-400">
            Ajuda quem perdeu o link a encontrar o bolão. Desmarque se ele for fechado —
            aí só entra quem receber o link de você.
          </span>
        </span>
      </label>
    </div>
  );
};

// Mensalidade da plataforma: gera o PIX e mostra a situação. Fica também em
// Configurações porque é para lá que o bolão bloqueado é mandado — o único
// lugar que ele ainda abre.
//
// Não pede CPF nem cadastro de débito automático: o Pix Automático exige que o
// banco do pagador suporte e que ele autorize no app, o que deixava metade dos
// organizadores sem conseguir pagar. Cobrança recorrente por cartão fica para
// quando houver volume que justifique a integração.
const MensalidadeCard = () => {
  const { tenantId, currentUser } = useApp();
  const [sub, setSub] = useState(null);
  const [pix, setPix] = useState(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'tenants', tenantId));
        if (vivo && snap.exists()) setSub(snap.data().subscription || null);
      } catch { /* sem permissão: o card some */ }
    })();
    return () => { vivo = false; };
  }, [tenantId]);

  if (!sub || currentUser?.globalAdmin) return null;

  const status = evaluateStatus(sub);
  const faltam = daysUntil(accessEndsAt(sub));
  const valor = ((Number(sub.priceCents) || 0) / 100).toFixed(2).replace('.', ',');
  const ate = accessEndsAt(sub) ? new Date(accessEndsAt(sub)).toLocaleDateString('pt-BR') : null;

  const rotulo = {
    active:  ['bg-green-100 text-green-700', 'EM DIA'],
    trial:   ['bg-ouro-100 text-ouro-700', 'EM TESTE'],
    overdue: ['bg-orange-100 text-orange-700', 'VENCIDA'],
    blocked: ['bg-red-100 text-red-700', 'BLOQUEADO'],
  }[status] || ['bg-gray-100 text-gray-600', status];

  const gerar = async () => {
    setBusy(true); setErro('');
    try {
      const idToken = await getIdToken();
      const res = await fetch('/api/billing/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, tenantId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Não foi possível gerar a cobrança');
      setPix(d);
    } catch (e) { setErro(e.message); } finally { setBusy(false); }
  };

  const copiar = async () => {
    try { await navigator.clipboard.writeText(pix.brCode); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch {}
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-bold">Mensalidade da plataforma</h3>
        <span className={`text-xs font-bold px-2 py-1 rounded-full ${rotulo[0]}`}>{rotulo[1]}</span>
      </div>

      <p className="text-sm text-gray-600 mb-4">
        {status === 'active' && ate && <>Seu bolão está ativo até <strong>{ate}</strong>.</>}
        {status === 'trial' && <>Seu período de teste termina em <strong>{Math.max(0, faltam)} dia(s)</strong>.</>}
        {status === 'overdue' && <>A mensalidade venceu. Regularize para o bolão não ser bloqueado.</>}
        {status === 'blocked' && <>O bolão está bloqueado. Pague o PIX abaixo para liberar na hora.</>}
        {' '}O valor é <strong>R$ {valor}/mês</strong>.
      </p>

      {erro && <p className="text-sm text-red-600 mb-3">{erro}</p>}

      {!pix ? (
        <button onClick={gerar} disabled={busy} className="v2-btn-primary px-5 py-2.5 text-sm disabled:opacity-60">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <DollarSign size={16} />}
          {busy ? 'Gerando...' : 'Gerar PIX da mensalidade'}
        </button>
      ) : (
        <div className="flex flex-col sm:flex-row gap-5 items-center border-t pt-4">
          {pix.qrCodeImage && <img src={pix.qrCodeImage} alt="QR Code do PIX" className="w-44 h-44 bg-[#ffffff] rounded-xl p-2" />}
          <div className="flex-1 w-full">
            <p className="text-sm font-semibold text-noite-800 mb-2">
              Pague o PIX. A liberação é automática assim que o banco confirmar.
            </p>
            <textarea readOnly value={pix.brCode || ''} rows={3} onFocus={(e) => e.target.select()}
              className="w-full text-xs font-mono p-2 rounded-lg border bg-[#ffffff] text-[#0a0f1a] resize-none" />
            <button onClick={copiar} className="mt-2 v2-btn-outline px-4 py-2 text-sm">
              <Copy size={14} /> {copiado ? 'Copiado!' : 'Copiar código PIX'}
            </button>
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-4">
        Pagamento mensal por PIX, sem cadastro de cartão. Débito automático entra
        em uma versão futura.
      </p>
    </div>
  );
};

// Assistente do primeiro acesso. Diferente de um tour que só aponta para os
// botões, aqui o organizador PREENCHE os dados enquanto avança — ao terminar,
// o bolão está apto a funcionar e só falta ele mandar o link para os amigos.
const SetupWizard = ({ aoFechar }) => {
  const { settings, updateSettings, tenantId, rounds } = useApp();
  const [passo, setPasso] = useState(0);
  // Marcado por padrão: quem chega ao fim normalmente não quer rever. Quem
  // desmarcar vê de novo no próximo acesso.
  const [naoMostrarMais, setNaoMostrarMais] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [resultadoRodadas, setResultadoRodadas] = useState('');
  const [pixKey, setPixKey] = useState(settings?.payment?.pixKey || settings?.pixKey || '');
  const [recebedor, setRecebedor] = useState(settings?.payment?.pixRecipientName || '');
  const [valor, setValor] = useState(settings?.betValue ?? 15);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const salvarCobranca = async () => {
    if (!String(pixKey).trim()) { setErro('Informe a chave PIX que vai receber as cartelas.'); return; }
    if (!(Number(valor) > 0)) { setErro('O valor da cartela precisa ser maior que zero.'); return; }
    setSalvando(true); setErro('');
    try {
      // Notação de ponto para não apagar os outros campos de payment
      // (provider e useEnvCredentials) que já vieram do cadastro.
      await updateSettings({
        'payment.pixKey': String(pixKey).trim(),
        'payment.pixRecipientName': String(recebedor).trim(),
        betValue: Number(valor),
      });
      setPasso(2);
    } catch (e) {
      setErro(e.message || 'Não foi possível salvar agora.');
    } finally {
      setSalvando(false);
    }
  };

  const buscarRodadas = async () => {
    setSincronizando(true); setResultadoRodadas('');
    try {
      const idToken = await getIdToken();
      const res = await fetch('/api/rounds/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, tenantId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `Falha (HTTP ${res.status})`);
      setResultadoRodadas(d.mensagem);
    } catch (e) {
      setResultadoRodadas('Não foi possível buscar as rodadas: ' + e.message);
    } finally {
      setSincronizando(false);
    }
  };

  const total = 5;
  const Cabecalho = ({ titulo, subtitulo }) => (
    <>
      <div className="flex items-center justify-between gap-3 mb-1">
        <p className="text-[11px] font-bold uppercase text-campo-600" style={{ letterSpacing: '0.14em' }}>
          Passo {passo + 1} de {total}
        </p>
        <button onClick={() => aoFechar(naoMostrarMais)} aria-label="Fechar" className="text-noite-400 hover:text-noite-700"><X size={18} /></button>
      </div>
      <h2 className="font-display text-2xl text-noite-900 mb-1" style={{ letterSpacing: '0.03em' }}>{titulo}</h2>
      {subtitulo && <p className="text-sm text-noite-500 mb-5">{subtitulo}</p>}
    </>
  );

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 overflow-y-auto p-4 flex items-start sm:items-center justify-center">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg my-auto p-6">
        {/* Trilha de progresso: mostra o quanto falta, que é o que segura
            alguém num formulário de configuração. */}
        <div className="flex gap-1.5 mb-5">
          {Array.from({ length: total }).map((_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full ${i <= passo ? 'bg-campo-600' : 'bg-gray-200'}`} />
          ))}
        </div>

        <label className="flex items-center gap-2 text-xs text-noite-500 mb-4 cursor-pointer select-none">
          <input type="checkbox" checked={naoMostrarMais}
            onChange={(e) => setNaoMostrarMais(e.target.checked)}
            className="w-4 h-4 accent-[#008542]" />
          Não mostrar este passo a passo novamente
        </label>

        {passo === 0 && (
          <>
            <Cabecalho titulo="Vamos deixar seu bolão pronto"
              subtitulo="Três passos rápidos. Ao final você já sai com o link para chamar a galera." />
            <ul className="text-sm text-noite-600 space-y-2.5 mb-6">
              <li><strong>1.</strong> A chave PIX que vai receber as cartelas e quanto custa cada uma.</li>
              <li><strong>2.</strong> As rodadas do Brasileirão no seu bolão.</li>
              <li><strong>3.</strong> O WhatsApp do bolão, que envia confirmações e cobranças.</li>
              <li><strong>4.</strong> O convite pronto para mandar no grupo.</li>
            </ul>
            <div className="flex justify-between items-center">
              <button onClick={() => aoFechar(naoMostrarMais)} className="text-xs text-noite-400 hover:text-noite-700">Fazer isso depois</button>
              <button onClick={() => setPasso(1)} className="v2-btn-primary px-5 py-2.5 text-sm">
                Começar <ChevronRight size={15} />
              </button>
            </div>
          </>
        )}

        {passo === 1 && (
          <>
            <Cabecalho titulo="Como você vai receber"
              subtitulo="Sem a chave PIX, os participantes não conseguem pagar a cartela." />
            <div className="space-y-4">
              <div>
                <label className="v2-label">Chave PIX que vai receber as cartelas</label>
                <input type="text" value={pixKey} onChange={(e) => setPixKey(e.target.value)}
                  placeholder="CPF, celular, e-mail ou chave aleatória" className="v2-input" />
                <p className="text-xs text-noite-400 mt-1">
                  É a chave da sua conta: o dinheiro das cartelas cai direto nela. Pode ser o
                  seu CPF, se for essa a chave que você usa.
                </p>
              </div>
              <div>
                <label className="v2-label">Nome de quem recebe</label>
                <input type="text" value={recebedor} onChange={(e) => setRecebedor(e.target.value)}
                  placeholder="Aparece para o participante conferir" className="v2-input" />
              </div>
              <div>
                <label className="v2-label">Valor da cartela (R$)</label>
                <input type="number" min="1" step="1" value={valor}
                  onChange={(e) => setValor(e.target.value)} className="v2-input" />
              </div>
            </div>
            {erro && <p className="text-sm text-red-600 mt-3">{erro}</p>}
            <div className="flex justify-between items-center mt-6">
              <button onClick={() => setPasso(0)} className="px-3 py-2 rounded-lg border text-sm inline-flex items-center gap-1 text-noite-600">
                <ChevronLeft size={15} /> Voltar
              </button>
              <button onClick={salvarCobranca} disabled={salvando} className="v2-btn-primary px-5 py-2.5 text-sm disabled:opacity-60">
                {salvando ? <Loader2 size={15} className="animate-spin" /> : null}
                Salvar e continuar <ChevronRight size={15} />
              </button>
            </div>
          </>
        )}

        {passo === 2 && (
          <>
            <Cabecalho titulo="Rodadas do Brasileirão"
              subtitulo="Os jogos entram automaticamente todos os dias. Aqui você confere se já estão no seu bolão." />
            <div className="rounded-xl border border-gray-200 p-4 mb-4">
              <p className="text-sm text-noite-600 mb-3">
                Seu bolão tem <strong>{rounds?.length || 0}</strong> rodada(s) cadastrada(s).
              </p>
              <button onClick={buscarRodadas} disabled={sincronizando}
                className="v2-btn-outline px-4 py-2.5 text-sm disabled:opacity-60">
                {sincronizando ? <Loader2 size={15} className="animate-spin" /> : <RefreshCcw size={15} />}
                Buscar rodadas agora
              </button>
              {resultadoRodadas && <p className="text-sm text-noite-600 mt-3 leading-relaxed">{resultadoRodadas}</p>}
              <p className="text-xs text-noite-400 mt-3 leading-relaxed">
                Rodada que já começou não é aberta: palpite com a partida em andamento
                seria injusto com quem apostou antes.
              </p>
            </div>
            <div className="flex justify-between items-center mt-6">
              <button onClick={() => setPasso(1)} className="px-3 py-2 rounded-lg border text-sm inline-flex items-center gap-1 text-noite-600">
                <ChevronLeft size={15} /> Voltar
              </button>
              <button onClick={() => setPasso(3)} className="v2-btn-primary px-5 py-2.5 text-sm">
                Continuar <ChevronRight size={15} />
              </button>
            </div>
          </>
        )}

        {passo === 3 && (
          <>
            <Cabecalho titulo="WhatsApp do bolão"
              subtitulo="Escaneie o QR Code com o celular que vai falar com os participantes." />
            <WhatsAppConnectCard />
            <div className="flex justify-between items-center mt-6">
              <button onClick={() => setPasso(2)} className="px-3 py-2 rounded-lg border text-sm inline-flex items-center gap-1 text-noite-600">
                <ChevronLeft size={15} /> Voltar
              </button>
              <div className="flex items-center gap-2">
                <button onClick={() => setPasso(4)} className="text-xs text-noite-400 hover:text-noite-700">Conectar depois</button>
                <button onClick={() => setPasso(4)} className="v2-btn-primary px-5 py-2.5 text-sm">
                  Continuar <ChevronRight size={15} />
                </button>
              </div>
            </div>
          </>
        )}

        {passo === 4 && (
          <>
            <Cabecalho titulo="Chame a galera"
              subtitulo="Seu bolão está pronto. Mande o convite e os palpites começam a chegar." />
            <ConviteCard />
            <div className="flex justify-between items-center mt-6">
              <button onClick={() => setPasso(3)} className="px-3 py-2 rounded-lg border text-sm inline-flex items-center gap-1 text-noite-600">
                <ChevronLeft size={15} /> Voltar
              </button>
              <button onClick={() => aoFechar(naoMostrarMais)} className="v2-btn-primary px-5 py-2.5 text-sm">
                <Check size={15} /> Concluir
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// Roteiro do primeiro acesso. A ordem segue o que o organizador precisa fazer
// para o bolão rodar, não a ordem do menu: primeiro o que trava a operação
// (PIX e WhatsApp), depois o dia a dia, e a assinatura por último.
const PASSOS_TOUR = [
  {
    titulo: 'Bem-vindo ao seu bolão',
    texto: 'São 6 passos rápidos mostrando o que configurar para começar a receber palpites. Dá para pular e rever quando quiser.',
  },
  {
    alvo: 'aba-settings', aba: 'settings',
    titulo: 'Comece pelas Configurações',
    texto: 'É aqui que você define a chave PIX que vai receber as cartelas, o valor de cada uma e o nome do bolão. Sem a chave PIX, ninguém consegue pagar.',
  },
  {
    alvo: 'whatsapp', aba: 'settings',
    titulo: 'Conecte o WhatsApp',
    texto: 'Escaneie o QR Code com o celular do bolão. É por esse número que saem as confirmações de cartela, as cobranças e os resultados de cada rodada.',
  },
  {
    alvo: 'aba-rounds', aba: 'rounds',
    titulo: 'Rodadas',
    texto: 'Os jogos do Brasileirão entram sozinhos todo dia. Aqui você abre a rodada para receber palpites e acompanha o encerramento.',
  },
  {
    alvo: 'aba-participants', aba: 'participants',
    titulo: 'Participantes',
    texto: 'Convide a galera pelo link do seu bolão e acompanhe quem já entrou. Cada pessoa se cadastra sozinha pelo WhatsApp.',
  },
  {
    alvo: 'aba-financial', aba: 'financial',
    titulo: 'Financeiro',
    texto: 'Veja quem pagou a cartela e dê baixa nos pagamentos. Os que estão em aberto aparecem destacados para você cobrar.',
  },
  {
    alvo: 'assinatura', aba: 'dashboard',
    titulo: 'Sua assinatura',
    texto: 'Você tem 7 dias de teste. Antes de acabar, ative a assinatura por aqui — sem ela o painel trava e os participantes não conseguem palpitar.',
  },
];

// Carteira da plataforma: quanto entra por mês e em que pé está cada bolão.
// Exportado para a rota /plataforma reaproveitar sem duplicar a tela.
export const PlataformaTab = () => {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');

  const carregar = async () => {
    setErro('');
    try {
      const idToken = await getIdToken();
      const res = await fetch('/api/admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Falha ao carregar');
      setDados(d);
    } catch (e) { setErro(e.message); }
  };

  useEffect(() => { carregar(); }, []);

  if (erro) return <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4">{erro}</div>;
  if (!dados) return <div className="flex items-center gap-2 text-gray-500 py-8"><Loader2 size={18} className="animate-spin" /> Carregando...</div>;

  const { resumo, boloes } = dados;
  const reais = (c) => `R$ ${((c || 0) / 100).toFixed(2).replace('.', ',')}`;
  const data = (ms) => ms ? new Date(ms).toLocaleDateString('pt-BR') : '—';

  const selo = {
    active:     ['bg-green-100 text-green-700',   'Ativo'],
    trial:      ['bg-ouro-100 text-ouro-700',     'Em teste'],
    overdue:    ['bg-orange-100 text-orange-700', 'Vencido'],
    blocked:    ['bg-red-100 text-red-700',       'Bloqueado'],
    // O fundo -100 não é convertido no dark mode, mas text-noite-600 é: sem a
    // cor literal, o rótulo ficaria claro sobre fundo claro.
    plataforma: ['bg-noite-100 text-[#374151]',   'Plataforma'],
  };

  const cartoes = [
    ['Receita mensal', reais(resumo.mrrCentavos), 'Só bolões pagando'],
    ['Bolões ativos', String(resumo.ativos), `de ${resumo.total} no total`],
    ['Em teste', String(resumo.emTeste), 'ainda não pagam'],
    ['Vencidos', String(resumo.vencidos), 'dentro da cortesia'],
    ['Bloqueados', String(resumo.bloqueados), 'operação travada'],
    ['Recorrentes', String(resumo.recorrentes), 'no Pix Automático'],
  ];

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="font-display text-2xl text-noite-900" style={{ letterSpacing: '0.04em' }}>PLATAFORMA</h2>
          <p className="text-noite-400 text-sm mt-1">Mensalidades de todos os bolões do SaaS.</p>
        </div>
        <button onClick={carregar} className="px-4 py-2 border rounded-lg text-sm inline-flex items-center gap-2 bg-white flex-shrink-0">
          <RefreshCcw size={14} /> Atualizar
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        {cartoes.map(([titulo, valor, nota]) => (
          <div key={titulo} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-noite-400 text-xs font-semibold uppercase" style={{ letterSpacing: '0.1em' }}>{titulo}</p>
            <p className="font-display text-2xl text-noite-900 mt-1">{valor}</p>
            <p className="text-noite-400 text-xs mt-0.5">{nota}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-noite-500">
                <th className="px-4 py-3 font-semibold">Bolão</th>
                <th className="px-4 py-3 font-semibold">Situação</th>
                <th className="px-4 py-3 font-semibold">Cobrança</th>
                <th className="px-4 py-3 font-semibold">Acesso até</th>
                <th className="px-4 py-3 font-semibold">Contato</th>
              </tr>
            </thead>
            <tbody>
              {boloes.map(b => {
                const [cor, rotulo] = selo[b.status] || ['bg-noite-100 text-noite-600', b.status];
                return (
                  <tr key={b.id} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-noite-800">{b.nome}</p>
                      <p className="text-noite-400 text-xs">{b.id}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-bold px-2 py-1 rounded-full ${cor}`}>{rotulo}</span>
                    </td>
                    <td className="px-4 py-3 text-noite-600">
                      {b.status === 'plataforma' ? '—' : (
                        <>
                          {reais(b.precoCentavos)}
                          <span className="block text-xs text-noite-400">
                            {b.recorrente ? 'recorrente' : 'avulsa'}{b.documento ? ` · ${b.documento}` : ''}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-noite-600">{data(b.acessoAte)}</td>
                    <td className="px-4 py-3 text-noite-600">
                      {b.email || '—'}
                      {b.whatsapp && <span className="block text-xs text-noite-400">{b.whatsapp}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// Pop-up de reativação, mostrado ao abrir o painel bloqueado.
//
// O aviso e o botão já existiam na tela, mas exigiam que o organizador
// procurasse. Com o bolão parado e os participantes cobrando, o caminho de
// voltar a funcionar tem que estar na frente dele, não a dois cliques.
const ModalBloqueio = ({ tenantId, aoFechar }) => {
  const [pix, setPix] = useState(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const [copiado, setCopiado] = useState(false);

  const gerar = async () => {
    setBusy(true); setErro('');
    try {
      const idToken = await getIdToken();
      const res = await fetch('/api/billing/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, tenantId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Não foi possível gerar a cobrança');
      setPix(d);
    } catch (e) { setErro(e.message); } finally { setBusy(false); }
  };

  const copiar = async () => {
    try { await navigator.clipboard.writeText(pix.brCode); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch {}
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60] overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-modal my-auto p-7">
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
            <AlertCircle size={28} className="text-red-600" />
          </div>
          <h2 className="font-display text-2xl text-noite-900 mb-2" style={{ letterSpacing: '0.03em' }}>
            SEU BOLÃO ESTÁ PARADO
          </h2>
          <p className="text-sm text-noite-500 leading-relaxed mb-5">
            Enquanto a mensalidade estiver em aberto, você não abre rodadas e seus
            participantes não conseguem palpitar. Pague o PIX abaixo e a liberação
            é <strong>imediata</strong>, assim que o banco confirmar.
          </p>
        </div>

        {erro && <p className="text-sm text-red-600 mb-3 text-center">{erro}</p>}

        {!pix ? (
          <button onClick={gerar} disabled={busy}
            className="w-full py-3.5 rounded-xl font-semibold text-[#0a0f1a] bg-ouro-500 hover:bg-ouro-400 shadow-button-ouro transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 size={18} className="animate-spin" /> : <DollarSign size={18} />}
            {busy ? 'Gerando cobrança...' : 'Gerar PIX e reativar meu bolão'}
          </button>
        ) : (
          <div className="flex flex-col items-center gap-4 border-t pt-5">
            {pix.qrCodeImage && <img src={pix.qrCodeImage} alt="QR Code do PIX" className="w-48 h-48 bg-[#ffffff] rounded-xl p-2" />}
            <div className="w-full">
              <p className="text-sm font-semibold text-noite-800 mb-2 text-center">
                Escaneie o QR Code ou copie o código:
              </p>
              <textarea readOnly value={pix.brCode || ''} rows={3} onFocus={(e) => e.target.select()}
                className="w-full text-xs font-mono p-2 rounded-lg border bg-[#ffffff] text-[#0a0f1a] resize-none" />
              <button onClick={copiar} className="v2-btn-outline w-full py-2.5 text-sm mt-2">
                <Copy size={15} /> {copiado ? 'Copiado!' : 'Copiar código PIX'}
              </button>
            </div>
          </div>
        )}

        <button onClick={aoFechar} className="w-full text-sm text-noite-400 hover:text-noite-700 mt-5">
          Ver o painel assim mesmo
        </button>
      </div>
    </div>
  );
};

const SubscriptionBanner = ({ onStatus }) => {
  const { tenantId, currentUser } = useApp();
  const [sub, setSub] = useState(null);
  const [pix, setPix] = useState(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'tenants', tenantId));
        if (!vivo || !snap.exists()) return;
        const s = snap.data().subscription || null;
        setSub(s);
        // O painel precisa saber se está bloqueado para trancar as ferramentas.
        if (onStatus) onStatus(s ? evaluateStatus(s) : null);
      } catch { /* sem permissão ou offline: o banner some, o painel segue */ }
    })();
    return () => { vivo = false; };
  }, [tenantId]);

  // O bolão da própria plataforma não se cobra.
  if (!sub || currentUser?.globalAdmin) return null;

  const status = evaluateStatus(sub);
  if (status === STATUS.ACTIVE) return null;

  const faltam = daysUntil(accessEndsAt(sub));
  const valor = ((Number(sub.priceCents) || 0) / 100).toFixed(2).replace('.', ',');

  // Cada tom precisa do par claro/escuro: os fundos -50 não são convertidos pelo
  // index.css, então sem a variante dark eles ficam claros enquanto o texto é
  // forçado para quase branco — e o aviso some.
  const tom = status === STATUS.BLOCKED
    ? { caixa: 'bg-red-50 border-red-300 dark:bg-red-500/10 dark:border-red-500/40', titulo: 'text-red-800 dark:text-red-300', texto: 'text-red-700 dark:text-red-200' }
    : status === STATUS.OVERDUE
      ? { caixa: 'bg-orange-50 border-orange-300 dark:bg-orange-500/10 dark:border-orange-500/40', titulo: 'text-orange-800 dark:text-orange-300', texto: 'text-orange-700 dark:text-orange-200' }
      : { caixa: 'bg-ouro-50 border-ouro-500 dark:bg-ouro-500/10', titulo: 'text-noite-900', texto: 'text-noite-600' };

  const titulo = status === STATUS.BLOCKED
    ? 'Bolão bloqueado por falta de pagamento'
    : status === STATUS.OVERDUE
      ? 'Mensalidade vencida'
      : faltam <= 0 ? 'Seu teste termina hoje' : `Faltam ${faltam} dia(s) de teste`;

  const detalhe = status === STATUS.BLOCKED
    ? 'Os participantes não conseguem enviar palpites até a regularização.'
    : status === STATUS.OVERDUE
      ? 'Regularize para o bolão não ser bloqueado.'
      : 'Ative a assinatura para o bolão continuar no ar quando o teste acabar.';

  const pagar = async () => {
    setBusy(true); setErro('');
    try {
      const idToken = await getIdToken();
      const res = await fetch('/api/billing/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, tenantId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Não foi possível gerar a cobrança');
      setPix(data);
    } catch (e) {
      setErro(e.message);
    } finally {
      setBusy(false);
    }
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(pix.brCode);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch { /* navegador sem clipboard: o código fica visível para copiar à mão */ }
  };

  return (
    <div data-tour="assinatura" className={`border-2 rounded-xl p-4 mb-5 ${tom.caixa}`}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="flex items-start gap-3">
          <AlertCircle size={20} className={tom.titulo} />
          <div>
            <p className={`font-bold ${tom.titulo}`}>{titulo}</p>
            <p className={`text-sm ${tom.texto}`}>{detalhe} R$ {valor}/mês.</p>
          </div>
        </div>
        {!pix && (
          <button onClick={pagar} disabled={busy}
            className="px-5 py-2.5 rounded-lg font-semibold text-[#0a0f1a] bg-ouro-500 hover:bg-ouro-400 shadow-button-ouro transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-60 flex-shrink-0">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <DollarSign size={16} />}
            {busy ? 'Gerando...' : 'Ativar meu bolão'}
          </button>
        )}
      </div>

      {erro && <p className="text-sm text-red-700 mt-3">{erro}</p>}

      {pix && (
        <div className="mt-4 pt-4 border-t border-black/10 flex flex-col sm:flex-row gap-5 items-center">
          {/* Branco literal: no dark mode o index.css converte bg-white em cor de
              card, e QR Code sobre fundo escuro não é lido pela câmera. */}
          {pix.qrCodeImage && <img src={pix.qrCodeImage} alt="QR Code do PIX" className="w-44 h-44 bg-[#ffffff] rounded-xl p-2" />}
          <div className="flex-1 w-full">
            <p className="text-sm font-semibold text-noite-800 mb-2">Pague o PIX para ativar. A liberação é automática.</p>
            <textarea readOnly value={pix.brCode || ''} rows={3}
              className="w-full text-xs font-mono p-2 rounded-lg border border-black/10 bg-[#ffffff] text-[#0a0f1a] resize-none" />
            <button onClick={copiar} className="mt-2 px-4 py-2 border rounded-lg text-sm inline-flex items-center gap-2 bg-white">
              <Copy size={14} /> {copiado ? 'Copiado!' : 'Copiar código PIX'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Conexão do WhatsApp do bolão via QR Code (Evolution multi-instância).
// O organizador escaneia o QR com o próprio número; conectado, os envios
// automáticos (confirmações, cobranças, resultados) passam a usar essa instância.
const WhatsAppConnectCard = () => {
  const { tenantId } = useApp();
  const [conn, setConn] = useState({ loading: true, state: null, number: '', qr: null, pairingCode: null, error: '' });
  // No celular ninguém escaneia o próprio QR: o WhatsApp aceita um código de
  // 8 caracteres digitado em "Conectar com número de telefone".
  const [modoCodigo, setModoCodigo] = useState(false);
  const [telefone, setTelefone] = useState('');
  const pollRef = useRef(null);
  const qrRef = useRef(null);

  const callApi = async (action, extra = {}) => {
    const idToken = await getIdToken();
    const res = await fetch('/api/evolution/instance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, tenantId, action, ...extra }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Falha na comunicação com o servidor');
    return data;
  };

  const stopPoll = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (qrRef.current) { clearInterval(qrRef.current); qrRef.current = null; }
  };

  const refresh = async () => {
    try {
      const d = await callApi('status');
      setConn(c => ({ ...c, loading: false, state: d.state, number: d.number || '', error: '', qr: d.state === 'open' ? null : c.qr }));
      if (d.state === 'open') stopPoll();
    } catch (e) {
      setConn(c => ({ ...c, loading: false, error: e.message }));
      stopPoll();
    }
  };

  // O Evolution rotaciona o QR a cada ~20s. Sem renovar a imagem, o código morre
  // enquanto o usuário navega até "Conectar um aparelho" no celular e o WhatsApp
  // recusa o vínculo.
  const refreshQr = async () => {
    try {
      // Renovar só faz sentido no QR, que rotaciona. O código de pareamento
      // vale até expirar e pedir outro invalidaria o que o organizador está
      // digitando no celular.
      if (modoCodigo) return;
      const d = await callApi('connect');
      if (d.state === 'open') {
        setConn({ loading: false, state: 'open', number: d.number || '', qr: null, pairingCode: null, error: '' });
        stopPoll();
        return;
      }
      if (d.qr) setConn(c => ({ ...c, qr: d.qr, error: '' }));
    } catch {
      // Mantém o QR atual na tela; o polling de status reporta falha persistente.
    }
  };

  const startPolling = () => {
    stopPoll();
    pollRef.current = setInterval(refresh, 4000);
    qrRef.current = setInterval(refreshQr, 12000);
  };

  useEffect(() => { refresh(); return stopPoll; }, [tenantId]);

  const handleConnect = async () => {
    if (modoCodigo && String(telefone).replace(/\D/g, '').length < 12) {
      setConn(c => ({ ...c, error: 'Informe o número com DDI e DDD, por exemplo 5564999998888.' }));
      return;
    }
    setConn(c => ({ ...c, loading: true, error: '' }));
    try {
      const d = await callApi('connect', modoCodigo ? { phone: telefone } : {});
      if (d.state === 'open') {
        setConn({ loading: false, state: 'open', number: d.number || '', qr: null, pairingCode: null, error: '' });
        return;
      }
      const obtido = d.pairingCode || d.qr;
      setConn({
        loading: false, state: 'connecting', number: '',
        qr: d.qr || null, pairingCode: d.pairingCode || null,
        error: obtido ? '' : (d.note || 'Não foi possível conectar agora — tente novamente'),
      });
      startPolling();
    } catch (e) {
      setConn(c => ({ ...c, loading: false, error: e.message }));
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Desconectar o WhatsApp deste bolão? Os envios automáticos param até conectar de novo.')) return;
    setConn(c => ({ ...c, loading: true, error: '' }));
    try {
      await callApi('disconnect');
      setConn({ loading: false, state: 'close', number: '', qr: null, error: '' });
    } catch (e) {
      setConn(c => ({ ...c, loading: false, error: e.message }));
    }
  };

  const qrSrc = conn.qr ? (conn.qr.startsWith('data:') ? conn.qr : `data:image/png;base64,${conn.qr}`) : null;

  return (
    <div data-tour="whatsapp" className="bg-white rounded-xl shadow-sm border p-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-bold">Conexão do WhatsApp do seu bolão</h3>
        {conn.state === 'open' && <span className="text-xs font-bold px-2 py-1 rounded-full bg-green-100 text-green-700">CONECTADO</span>}
        {conn.state === 'connecting' && <span className="text-xs font-bold px-2 py-1 rounded-full bg-yellow-100 text-yellow-700">AGUARDANDO QR</span>}
        {(conn.state === 'close' || conn.state === 'not_created') && <span className="text-xs font-bold px-2 py-1 rounded-full bg-gray-100 text-gray-600">DESCONECTADO</span>}
      </div>

      {conn.loading && (
        <div className="flex items-center gap-2 text-gray-500 py-4"><Loader2 size={18} className="animate-spin" /> Verificando conexão...</div>
      )}

      {!conn.loading && conn.state === 'open' && (
        <div>
          <p className="text-sm text-gray-600 mb-4">
            WhatsApp conectado{conn.number ? <> como <strong>+{conn.number}</strong></> : ''}. As confirmações de cartela,
            cobranças e resultados das rodadas são enviados automaticamente por este número.
          </p>
          <button onClick={handleDisconnect} className="px-4 py-2 border border-red-300 text-red-600 rounded-lg text-sm">Desconectar</button>
        </div>
      )}

      {!conn.loading && conn.state !== 'open' && (
        <div>
          {qrSrc ? (
            <div className="flex flex-col sm:flex-row gap-5 items-center">
              <img src={qrSrc} alt="QR Code para conectar o WhatsApp" className="w-52 h-52 border rounded-xl bg-[#ffffff] p-2" />
              <div className="text-sm text-gray-600 space-y-2">
                <p className="font-semibold text-gray-800">Escaneie com o celular do bolão:</p>
                <ol className="list-decimal pl-5 space-y-1">
                  <li>Abra o <strong>WhatsApp</strong> no celular</li>
                  <li>Toque em <strong>Aparelhos conectados</strong></li>
                  <li>Toque em <strong>Conectar um aparelho</strong></li>
                  <li>Aponte a câmera para este QR Code</li>
                </ol>
                <p className="text-xs text-gray-400">O código se renova sozinho enquanto esta tela estiver aberta. Escaneie sem pressa — ela avisa assim que conectar.</p>
                <button onClick={handleConnect} className="px-4 py-2 border rounded-lg text-sm inline-flex items-center gap-2"><RefreshCcw size={14} /> Gerar novo QR</button>
              </div>
            </div>
          ) : conn.pairingCode ? (
            <div>
              <p className="font-semibold text-gray-800 mb-2">Digite este código no WhatsApp:</p>
              <p className="font-mono tracking-[0.3em] text-3xl text-noite-900 bg-gray-50 rounded-xl py-4 text-center mb-3">
                {conn.pairingCode}
              </p>
              <ol className="list-decimal pl-5 space-y-1 text-sm text-gray-600">
                <li>Abra o <strong>WhatsApp</strong> no celular do bolão</li>
                <li>Toque em <strong>Aparelhos conectados</strong></li>
                <li>Toque em <strong>Conectar um aparelho</strong></li>
                <li>Toque em <strong>Conectar com número de telefone</strong></li>
                <li>Digite o código acima</li>
              </ol>
              <p className="text-xs text-gray-400 mt-3">
                O código vale por alguns minutos. Esta tela avisa assim que conectar.
              </p>
            </div>
          ) : (
            <div>
              <p className="text-sm text-gray-600 mb-4">
                Conecte o número de WhatsApp do seu bolão. Com ele conectado, o sistema envia
                automaticamente as confirmações de cartela, cobranças e resultados das rodadas
                para os seus participantes.
              </p>

              {/* Escolha do método. No celular o QR é inútil: não dá para o
                  próprio aparelho escanear a tela dele mesmo. */}
              {/* Estes dois botões ESCOLHEM o método; quem conecta é o botão
                  de baixo. O rótulo antigo ("Ler QR Code") parecia a ação em si,
                  então o organizador clicava, não acontecia nada visível e ele
                  concluía que estava quebrado. */}
              <p className="text-xs font-medium text-gray-500 mb-2">Como você vai conectar:</p>
              <div className="flex gap-2 mb-4">
                <button onClick={() => setModoCodigo(false)}
                  className={`px-3 py-2 rounded-lg text-sm border ${!modoCodigo ? 'border-green-600 text-green-700 font-semibold' : 'text-gray-500'}`}>
                  Tenho outro aparelho
                </button>
                <button onClick={() => setModoCodigo(true)}
                  className={`px-3 py-2 rounded-lg text-sm border ${modoCodigo ? 'border-green-600 text-green-700 font-semibold' : 'text-gray-500'}`}>
                  Estou no celular do bolão
                </button>
              </div>

              {modoCodigo ? (
                <div className="mb-4">
                  <label className="v2-label">Número do WhatsApp do bolão</label>
                  <input type="tel" inputMode="numeric" placeholder="5564999998888"
                    value={telefone} onChange={(e) => setTelefone(e.target.value.replace(/\D/g, ''))}
                    className="v2-input" />
                  <p className="text-xs text-gray-400 mt-1">
                    Com DDI e DDD, só números. Você vai receber um código para digitar no WhatsApp.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-gray-400 mb-4">
                  Vamos gerar um QR Code na tela para você escanear com o celular do bolão.
                  Se você já está NO celular do bolão, use a outra opção — não dá para o
                  aparelho escanear a própria tela.
                </p>
              )}

              <button onClick={handleConnect} className="px-5 py-2.5 bg-green-600 text-white rounded-lg text-sm font-semibold inline-flex items-center gap-2">
                <Send size={16} /> {modoCodigo ? 'Gerar código de conexão' : 'Conectar WhatsApp (QR Code)'}
              </button>
            </div>
          )}
        </div>
      )}

      {conn.error && <p className="text-sm text-red-600 mt-3">{conn.error}</p>}
    </div>
  );
};

const EstablishmentForm = ({ establishment, onSave, onCancel }) => {
  const [formData, setFormData] = useState(establishment || { name: '', contact: '', phone: '', commission: 5 });

  const handleSave = () => {
    if (!formData.name) {
      alert('Preencha o nome do estabelecimento!');
      return;
    }
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b flex justify-between items-center sticky top-0 bg-white">
          <h3 className="text-2xl font-bold">{establishment ? 'Editar' : 'Novo'} Estabelecimento</h3>
          <button onClick={onCancel}><X size={24} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Nome do Estabelecimento *</label>
            <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full px-4 py-2 border rounded-lg" placeholder="Ex: Bar do João" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Contato (Nome)</label>
            <input type="text" value={formData.contact} onChange={(e) => setFormData({ ...formData, contact: e.target.value })} className="w-full px-4 py-2 border rounded-lg" placeholder="Ex: João Silva" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Telefone/WhatsApp</label>
            <input type="tel" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className="w-full px-4 py-2 border rounded-lg" placeholder="Ex: 11999999999" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Comissão (%)</label>
            <input type="number" min="0" max="100" step="0.5" value={formData.commission} onChange={(e) => setFormData({ ...formData, commission: parseFloat(e.target.value) })} className="w-full px-4 py-2 border rounded-lg" />
            <p className="text-xs text-gray-500 mt-1">Padrão: 5%</p>
          </div>
        </div>
        <div className="p-6 border-t flex gap-3 sticky bottom-0 bg-white">
          <button onClick={onCancel} className="flex-1 px-6 py-2 border rounded-lg">Cancelar</button>
          <button onClick={handleSave} className="flex-1 px-6 py-2 bg-green-600 text-white rounded-lg">Salvar</button>
        </div>
      </div>
    </div>
  );
};

const TeamForm = ({ team, onSave, onCancel }) => {
  const { teams, rounds } = useApp();
  const [formData, setFormData] = useState(team || { name: '', logo: '', logoType: 'url' });
  const normalizeName = (s) => s?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const protectedStatuses = new Set(['open','closed','finished']);
  const isProtected = team?.id ? rounds?.some(r => protectedStatuses.has(r?.status) && Array.isArray(r?.matches) && r.matches.some(m => m.homeTeamId === team.id || m.awayTeamId === team.id)) : false;

  const handleSave = () => {
    // Escudo é OPCIONAL. Exigi-lo travava o caso mais comum de campeonato
    // amador: o time do bairro não tem logo, e o organizador ficava sem
    // cadastrar. Sem escudo, getSafeLogo gera um avatar com as iniciais.
    if (!formData.name?.trim()) {
      alert('Informe o nome do time.');
      return;
    }
    const exists = teams?.some(t => normalizeName(t.name) === normalizeName(formData.name) && (!team || t.id !== team.id));
    if (exists) {
      alert('Já existe um time com esse nome.');
      return;
    }
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b flex justify-between items-center sticky top-0 bg-white">
          <h3 className="text-2xl font-bold">{team ? 'Editar Time' : 'Novo Time'}</h3>
          <button onClick={onCancel}><X size={24} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Nome do Time</label>
            <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} disabled={isProtected} className="w-full px-4 py-2 border rounded-lg" placeholder="Ex: Flamengo" />
            {isProtected && (<p className="text-xs text-amber-600 mt-1">Nome bloqueado: time vinculado a rodadas ativas/fechadas/finalizadas.</p>)}
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">
              Escudo <span className="text-gray-400 font-normal">(opcional)</span>
            </label>
            <p className="text-xs text-gray-400 mb-3">
              Sem escudo, o time aparece com as iniciais do nome — útil para campeonato amador.
            </p>
            <div className="flex gap-2 mb-3">
              <button onClick={() => setFormData({ ...formData, logoType: 'url' })} className={`flex-1 py-2 px-4 rounded-lg border ${formData.logoType === 'url' ? 'bg-green-600 text-white' : 'bg-white'}`}>
                <ExternalLink size={16} className="inline mr-2" /> URL
              </button>
              <button onClick={() => setFormData({ ...formData, logoType: 'upload' })} className={`flex-1 py-2 px-4 rounded-lg border ${formData.logoType === 'upload' ? 'bg-green-600 text-white' : 'bg-white'}`}>
                <Upload size={16} className="inline mr-2" /> Upload
              </button>
            </div>
            {formData.logoType === 'url' ? (
              <input type="url" value={formData.logo} onChange={(e) => setFormData({ ...formData, logo: e.target.value })} className="w-full px-4 py-2 border rounded-lg" placeholder="https://exemplo.com/logo.png" />
            ) : (
              <input type="file" accept="image/*" onChange={(e) => {
                const file = e.target.files[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onload = (e) => setFormData({ ...formData, logo: e.target.result });
                  reader.readAsDataURL(file);
                }
              }} className="w-full px-4 py-2 border rounded-lg" />
            )}
            {formData.logo && <img src={formData.logo} alt="Preview" className="w-24 h-24 object-contain mx-auto mt-4" />}
          </div>
        </div>
        <div className="p-6 border-t flex gap-3 sticky bottom-0 bg-white">
          <button onClick={onCancel} className="flex-1 px-6 py-2 border rounded-lg">Cancelar</button>
          <button onClick={handleSave} className="flex-1 px-6 py-2 bg-green-600 text-white rounded-lg">Salvar</button>
        </div>
      </div>
    </div>
  );
};

const RoundForm = ({ round, teams, rounds, onSave, onCancel }) => {
  const toLocalInputFromISO = (iso) => {
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      // BRT = UTC-3 fixo (Brasil não tem horário de verão desde 2019)
      const brtMs = d.getTime() - 3 * 60 * 60 * 1000;
      const b = new Date(brtMs);
      const p = n => String(n).padStart(2, '0');
      return `${b.getUTCFullYear()}-${p(b.getUTCMonth()+1)}-${p(b.getUTCDate())}T${p(b.getUTCHours())}:${p(b.getUTCMinutes())}`;
    } catch {
      return '';
    }
  };

  const toUtcIsoFromLocalInput = (localVal) => {
    try {
      // Trata o input como horário de Brasília (UTC-3)
      const d = new Date(localVal + ':00.000-03:00');
      if (isNaN(d.getTime())) return '';
      return d.toISOString();
    } catch {
      return '';
    }
  };

  const [formData, setFormData] = useState(() => {
    if (round) {
      const closeLocal = round.closeAt ? toLocalInputFromISO(round.closeAt) : '';
      return {
        ...round,
        closeAt: closeLocal,
        matches: (round.matches || []).map(m => ({
          ...m,
          date: m.date ? toLocalInputFromISO(m.date) : ''
        }))
      };
    }
    return { number: rounds.length + 1, name: `Rodada ${rounds.length + 1}`, status: 'upcoming', matches: [], closeAt: '' };
  });

  const addMatch = () => {
    setFormData({
      ...formData,
      // `manual: true` é o que diz ao sistema que o placar deste jogo nunca vem
      // da API — quem lança é o organizador, e por isso a rodada passa a
      // depender dele para ser finalizada.
      matches: [...(formData.matches || []), { id: Date.now(), homeTeamId: teams[0]?.id, awayTeamId: teams[1]?.id, date: '', homeScore: null, awayScore: null, finished: false, manual: true }]
    });
  };

  const updateMatch = (matchId, field, value) => {
    setFormData({
      ...formData,
      matches: formData.matches.map(m => m.id === matchId ? { ...m, [field]: value } : m)
    });
  };

  const removeMatch = (matchId) => {
    setFormData({ ...formData, matches: formData.matches.filter(m => m.id !== matchId) });
  };

  const temManualNoForm = temJogoManual(formData.matches || []);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b sticky top-0 bg-white">
          <h3 className="text-2xl font-bold">{round ? 'Editar Rodada' : 'Adicionar rodada manual'}</h3>
        </div>
        <div className="p-6 space-y-6">
          {/* O organizador precisa saber ANTES de montar a rodada que ela sai
              da automação. Descobrir isso depois, com a rodada parada
              esperando um placar que nunca chega, é o pior momento. */}
          {temManualNoForm && (
            <div className="rounded-xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-500/10 p-4">
              <p className="font-semibold text-amber-900 dark:text-amber-200 mb-1">
                Esta rodada tem jogo manual
              </p>
              <ul className="text-sm text-amber-800 dark:text-amber-200 space-y-1 list-disc list-inside">
                <li>Os jogos que você criou aqui <strong>não recebem placar da tabela oficial</strong> — o resultado é você quem lança.</li>
                <li>Os jogos vindos da tabela oficial continuam atualizando sozinhos, normalmente.</li>
                <li>A rodada <strong>não encerra sozinha</strong>: depois de lançar os placares dos jogos manuais, use o botão <strong>Finalizar</strong> na lista de rodadas para apurar e publicar o ranking.</li>
                <li>Os participantes veem um aviso de que há jogos aguardando o seu lançamento.</li>
              </ul>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Número</label>
              <input type="number" value={formData.number} onChange={(e) => setFormData({ ...formData, number: parseInt(e.target.value) })} className="w-full px-4 py-2 border rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Nome</label>
              <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full px-4 py-2 border rounded-lg" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Status</label>
            <select value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })} className="w-full px-4 py-2 border rounded-lg">
              <option value="upcoming">🔜 Futura</option>
              <option value="open">✅ Aberta</option>
              <option value="closed">🔒 Fechada</option>
              <option value="finished">🏁 Finalizada</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Fechamento programado</label>
            <input
              type="datetime-local"
              value={formData.closeAt || ''}
              onChange={(e) => setFormData({ ...formData, closeAt: e.target.value })}
              className="w-full px-4 py-2 border rounded-lg"
            />
            <p className="text-xs text-gray-500 mt-1">Após este horário, palpites serão bloqueados automaticamente.</p>
          </div>
          <div>
            <div className="flex justify-between mb-4">
              <h4 className="text-lg font-semibold">Jogos</h4>
              <button onClick={addMatch} className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg">
                <Plus size={16} /> Adicionar
              </button>
            </div>
            <div className="space-y-4">
              {formData.matches?.map((match) => (
                <div key={match.id} className="bg-gray-50 p-4 rounded-lg border">
                  <div className="grid grid-cols-12 gap-3 items-center">
                    <div className="col-span-12 sm:col-span-5">
                      <select value={match.homeTeamId} onChange={(e) => updateMatch(match.id, 'homeTeamId', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
                        {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
                      </select>
                    </div>
                    <div className="col-span-12 sm:col-span-2 text-center font-bold">VS</div>
                    <div className="col-span-12 sm:col-span-5">
                      <select value={match.awayTeamId} onChange={(e) => updateMatch(match.id, 'awayTeamId', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
                        {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
                      </select>
                    </div>
                    <div className="col-span-12 sm:col-span-9">
                      <input type="datetime-local" value={match.date} onChange={(e) => updateMatch(match.id, 'date', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
                    </div>
                    <div className="col-span-12 sm:col-span-3 flex sm:justify-end">
                      <button onClick={() => removeMatch(match.id)} className="text-red-600 p-2"><Trash2 size={18} /></button>
                    </div>
                    <div className="col-span-12 flex items-center gap-2">
                      <input type="checkbox" checked={match.finished} onChange={(e) => updateMatch(match.id, 'finished', e.target.checked)} className="w-4 h-4" />
                      <label className="text-sm">Jogo finalizado</label>
                    </div>
                    {match.finished && (
                      <div className="col-span-12 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <input
                          type="number"
                          placeholder="Gols Casa"
                          min="0"
                          value={match.homeScore ?? ''}
                          onChange={(e) => updateMatch(
                            match.id,
                            'homeScore',
                            e.target.value === '' ? null : parseInt(e.target.value, 10)
                          )}
                          className="px-3 py-2 border rounded-lg"
                        />
                        <input
                          type="number"
                          placeholder="Gols Fora"
                          min="0"
                          value={match.awayScore ?? ''}
                          onChange={(e) => updateMatch(
                            match.id,
                            'awayScore',
                            e.target.value === '' ? null : parseInt(e.target.value, 10)
                          )}
                          className="px-3 py-2 border rounded-lg"
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="p-6 border-t flex gap-3 sticky bottom-0 bg-white">
          <button onClick={onCancel} className="px-6 py-2 border rounded-lg">Cancelar</button>
          <button
            onClick={() => {
              if (formData.closeAt) {
                const ts = new Date(formData.closeAt).getTime();
                if (isNaN(ts)) {
                  alert('Data/horário de fechamento inválida(o).');
                  return;
                }
                // Para status 'upcoming' ou 'open', exigir futuro
                if ((formData.status === 'upcoming' || formData.status === 'open') && ts <= Date.now()) {
                  alert('A data/horário de fechamento deve ser no futuro para rodadas abertas/futuras.');
                  return;
                }
              }
              const toSave = {
                ...formData,
                closeAt: formData.closeAt ? toUtcIsoFromLocalInput(formData.closeAt) : '',
                matches: (formData.matches || []).map(m => ({
                  ...m,
                  date: m.date ? toUtcIsoFromLocalInput(m.date) : ''
                }))
              };
              onSave(toSave);
            }}
            className="px-6 py-2 bg-green-600 text-white rounded-lg"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
};

const PasswordModal = ({ user, onSave, onCancel }) => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const handleSave = () => {
    const checagem = validaSenha(newPassword);
    if (!checagem.ok) { setError(checagem.erro); return; }
    if (newPassword !== confirmPassword) {
      setError('Senhas não coincidem!');
      return;
    }
    onSave(newPassword);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b flex justify-between items-center sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <Key className="text-green-600" size={24} />
            <h3 className="text-2xl font-bold">Redefinir Senha</h3>
          </div>
          <button onClick={onCancel}><X size={24} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-sm text-blue-800">
              <strong>Usuário:</strong> {user.name}<br />
              <strong>WhatsApp:</strong> {user.whatsapp}
            </p>
          </div>
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">{error}</div>}
          <CampoSenha rotulo="Nova Senha" valor={newPassword} onChange={setNewPassword} medidor
            className="w-full px-4 py-2 border rounded-lg" autoComplete="new-password"
            placeholder={`Mínimo ${MIN_SENHA} caracteres`} />
          <CampoSenha rotulo="Confirmar Senha" valor={confirmPassword} onChange={setConfirmPassword}
            className="w-full px-4 py-2 border rounded-lg" autoComplete="new-password"
            onEnter={handleSave} placeholder="Digite novamente" />
        </div>
        <div className="p-6 border-t flex gap-3">
          <button onClick={onCancel} className="flex-1 px-6 py-2 border rounded-lg">Cancelar</button>
          <button onClick={handleSave} className="flex-1 px-6 py-2 bg-green-600 text-white rounded-lg">Alterar Senha</button>
        </div>
      </div>
    </div>
  );
};

const UserEditModal = ({ user, onSave, onCancel }) => {
  const [name, setName] = useState(user.name || '');
  const [whatsapp, setWhatsapp] = useState(user.whatsapp || '');
  const [email, setEmail] = useState(user.email || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!name.trim()) { setError('Nome é obrigatório'); return; }
    const emailTrim = email.trim();
    if (emailTrim && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
      setError('Email inválido'); return;
    }
    setError(''); setSaving(true);
    try {
      await onSave({ name: name.trim(), whatsapp: whatsapp.replace(/\D/g, ''), email: emailTrim });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-md w-full">
        <div className="p-6 border-b flex justify-between items-center">
          <h3 className="text-2xl font-bold">Editar Usuário</h3>
          <button onClick={onCancel}><X size={24} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Nome</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full px-4 py-2 border rounded-lg" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">WhatsApp</label>
            <input type="text" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className="w-full px-4 py-2 border rounded-lg" placeholder="DDD + número" />
            <p className="text-xs text-gray-500 mt-1">Alterar o WhatsApp também muda o login do usuário.</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Email (contato)</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-4 py-2 border rounded-lg" placeholder="email@exemplo.com" />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
        <div className="p-6 border-t flex gap-3">
          <button onClick={onCancel} className="flex-1 px-6 py-2 border rounded-lg">Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 px-6 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-60">
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
};

const AdminPanel = ({ setView }) => {
  const { currentUser, setCurrentUser, logout, teams, rounds, users, predictions, establishments, settings, communications, tenantId, addRound, updateRound, deleteRound, addTeam, updateTeam, deleteTeam, updateUser, deleteUser, resetTeamsToSerieA2026, updatePrediction, updateSettings, addEstablishment, updateEstablishment, deleteEstablishment, addCommunication, updateCommunication, teamImportRequests, submitImportRequestsFromApi, approveImportRequest, rejectImportRequest } = useApp();
  
  console.log('AdminPanel - Settings:', settings);
  
  const [activeTab, setActiveTab] = useState('financial');
  const [subStatus, setSubStatus] = useState(null);
  // Só para a sessão atual: recarregar traz o aviso de volta, porque o bolão
  // segue parado e o organizador precisa lembrar disso.
  const [bloqueioDispensado, setBloqueioDispensado] = useState(false);

  // Tour de primeira execução. A marca fica no navegador porque é preferência
  // de interface, não dado do bolão — e assim não custa escrita no Firestore
  // nem exige mudança nas regras.
  const chaveTour = `tour-admin:${currentUser?.id || 'anon'}:${tenantId}`;
  const [mostrarTour, setMostrarTour] = useState(false);
  const [mostrarWizard, setMostrarWizard] = useState(false);

  // No primeiro acesso abre o ASSISTENTE, não o tour: apontar para os botões
  // sem deixar preencher obriga o organizador a refazer tudo depois.
  useEffect(() => {
    if (!currentUser?.id || currentUser?.globalAdmin) return;
    try {
      if (!localStorage.getItem(chaveTour)) setMostrarWizard(true);
    } catch { /* navegador sem localStorage: só não mostra */ }
  }, [chaveTour, currentUser?.id, currentUser?.globalAdmin]);

  const marcarVisto = () => {
    try { localStorage.setItem(chaveTour, new Date().toISOString()); } catch { /* idem */ }
  };
  const encerrarTour = () => { setMostrarTour(false); marcarVisto(); };
  // Só marca como visto se o organizador pediu. Desmarcando o checkbox ele
  // reencontra o assistente no próximo acesso.
  const encerrarWizard = (naoMostrarMais = true) => {
    setMostrarWizard(false);
    if (naoMostrarMais) marcarVisto();
  };
  const [editingRound, setEditingRound] = useState(null);
  const [editingTeam, setEditingTeam] = useState(null);
  const [editingEstablishment, setEditingEstablishment] = useState(null);
  const [showRoundForm, setShowRoundForm] = useState(false);
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [showEstablishmentForm, setShowEstablishmentForm] = useState(false);
  const [editingPassword, setEditingPassword] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [selectedFinanceRound, setSelectedFinanceRound] = useState(null);
  const [selectedDashboardRound, setSelectedDashboardRound] = useState(null);
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [establishmentFilter, setEstablishmentFilter] = useState('all');
  const [whatsappMessage, setWhatsappMessage] = useState(settings?.whatsappMessage || '');
  const [chargeMessageTemplate, setChargeMessageTemplate] = useState(settings?.chargeMessageTemplate || '');
  const [betValue, setBetValue] = useState(settings?.betValue || 15);
  const [devolutionLink, setDevolutionLink] = useState(settings?.devolution?.link || '');
  const [devolutionInstance, setDevolutionInstance] = useState(settings?.devolution?.instanceName || '');
  const [devolutionToken, setDevolutionToken] = useState(settings?.devolution?.token || '');
  const [pdfLoadingRoundId, setPdfLoadingRoundId] = useState(null);
  const [adminPlayerModal, setAdminPlayerModal] = useState(null);
  const [settingsTab, setSettingsTab] = useState('whatsapp');
  // Manutenção do sistema
  const [maintenanceMode, setMaintenanceMode] = useState(!!settings?.maintenanceMode);
  const [maintenanceMessage, setMaintenanceMessage] = useState(settings?.maintenanceMessage || 'Estamos realizando uma manutenção programada para melhorar sua experiência. Por favor, tente novamente em breve.');
  const [maintenanceUntilInput, setMaintenanceUntilInput] = useState(settings?.maintenanceUntil ? new Date(settings.maintenanceUntil).toISOString().slice(0, 16) : '');
  const [maintenanceAllowedIps, setMaintenanceAllowedIps] = useState((settings?.maintenanceAllowedIps || []).join(', '));
  const [maintenanceScheduleStart, setMaintenanceScheduleStart] = useState('');
  const [maintenanceScheduleEnd, setMaintenanceScheduleEnd] = useState('');
  // WhatsApp
  const [whatsappProvider, setWhatsappProvider] = useState(settings?.whatsapp?.provider || (settings?.devolution?.link ? 'evolution' : 'cloud'));
  const [whatsappApiToken, setWhatsappApiToken] = useState(settings?.whatsapp?.apiToken || '');
  const [whatsappNumber, setWhatsappNumber] = useState(settings?.whatsapp?.number || '');
  const [whatsappNotifyEnabled, setWhatsappNotifyEnabled] = useState(settings?.whatsapp?.notifyEnabled ?? true);
  const [whatsappNotifyEvents, setWhatsappNotifyEvents] = useState(settings?.whatsapp?.notifyEvents || { charges: true, approvals: true, results: true });
  // Regras extras
  const [termsOfUse, setTermsOfUse] = useState(settings?.termsOfUse || '');
  const [systemPolicies, setSystemPolicies] = useState(settings?.systemPolicies || '');
  const [limitsRestrictions, setLimitsRestrictions] = useState(settings?.limitsRestrictions || '');
  const [complianceConfig, setComplianceConfig] = useState(settings?.complianceConfig || '');
  // Valor da aposta avançado
  const [minBet, setMinBet] = useState(settings?.betConfig?.minBet || 10);
  const [maxBet, setMaxBet] = useState(settings?.betConfig?.maxBet || 100);
  const [bonusEnabled, setBonusEnabled] = useState(settings?.betConfig?.bonus?.enabled ?? false);
  const [bonusPercent, setBonusPercent] = useState(settings?.betConfig?.bonus?.percent || 0);
  const [adminFeePercent, setAdminFeePercent] = useState(settings?.betConfig?.fees?.adminPercent ?? 10);
  const [establishmentPercent, setEstablishmentPercent] = useState(settings?.betConfig?.fees?.establishmentPercent ?? 5);
  const [limitsByTypeText, setLimitsByTypeText] = useState(settings?.betConfig?.typesLimitsText || '');
  // API de Pagamento
  const [paymentProvider, setPaymentProvider] = useState(settings?.payment?.provider || 'pix_manual');
  const [paymentPixEnabled, setPaymentPixEnabled] = useState(settings?.payment?.methods?.pix ?? true);
  const [paymentCardEnabled, setPaymentCardEnabled] = useState(settings?.payment?.methods?.card ?? false);
  const [transactionFeePercent, setTransactionFeePercent] = useState(settings?.payment?.transactionFeePercent || 0);
  const [paymentAllowedIps, setPaymentAllowedIps] = useState((settings?.payment?.allowedIps || []).join(', '));
  const [signatureHeaderName, setSignatureHeaderName] = useState(settings?.payment?.signatureHeaderName || 'x-signature');
  const [paymentRetries, setPaymentRetries] = useState(settings?.payment?.retries || 3);
  const [paymentTimeoutMs, setPaymentTimeoutMs] = useState(settings?.payment?.timeoutMs || 10000);
  const [showAdvancedPayment, setShowAdvancedPayment] = useState(false);
  // PIX (Manual)
  const [pixKey, setPixKey] = useState(settings?.payment?.pixKey || '');
  const [pixRecipientName, setPixRecipientName] = useState(settings?.payment?.pixRecipientName || settings?.pixRecipientName || '');
  // Integrações
  const [wooviAppId, setWooviAppId] = useState(settings?.woovi?.appId || '');
  const [wooviWebhookSecret, setWooviWebhookSecret] = useState(settings?.woovi?.webhookSecret || '');
  const [showWooviAppId, setShowWooviAppId] = useState(false);
  const [showWooviSecret, setShowWooviSecret] = useState(false);
  const [footballApiKey, setFootballApiKey] = useState(settings?.footballApi?.key || '');
  const [whatsappGroupJid, setWhatsappGroupJid] = useState(settings?.whatsapp?.groupJid || '');
  // O endereço público do sistema saiu daqui: é o mesmo para todos os bolões e
  // agora vem da env APP_URL (api/_shared/appUrl.js). Enquanto era um campo, o
  // valor antigo ficava gravado e vencia a env, mandando link do domínio velho.
  const [syncRoundsLoading, setSyncRoundsLoading] = useState(false);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [dryRunResult, setDryRunResult] = useState(null);
  const validatePixKey = (key) => {
    const k = (key || '').trim();
    if (!k) return { valid: false, msg: 'Informe a chave PIX.' };
    const isEmail = /\S+@\S+\.\S+/.test(k);
    const digits = k.replace(/\D/g, '');
    const isCpfCnpj = digits.length === 11 || digits.length === 14;
    const isPhone = /^\+?\d{10,14}$/.test(k.replace(/\s/g, ''));
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(k);
    const valid = isEmail || isCpfCnpj || isPhone || isUuid;
    return valid ? { valid: true } : { valid: false, msg: 'Formato de chave PIX inválido.' };
  };
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  useEffect(() => {
    if (activeTab === 'financial' && !selectedFinanceRound && rounds.length > 0) {
      const openRound = rounds.find(r => r.status === 'open');
      if (openRound) {
        setSelectedFinanceRound(openRound.id);
      } else {
        const sorted = [...rounds].sort((a, b) => {
          const tA = a.createdAt?.seconds || 0;
          const tB = b.createdAt?.seconds || 0;
          return tB - tA;
        });
        setSelectedFinanceRound(sorted[0].id);
      }
    }
  }, [activeTab, rounds, selectedFinanceRound]);

  // Testes A/B
  const [abTestsEnabled, setAbTestsEnabled] = useState(settings?.abTests?.enabled ?? false);
  const [experimentDashboardPercent, setExperimentDashboardPercent] = useState(settings?.abTests?.experiments?.newDashboard || 0);
  const [experimentPaymentFlowPercent, setExperimentPaymentFlowPercent] = useState(settings?.abTests?.experiments?.paymentFlowV2 || 0);
  // Histórico
  const [settingsHistory, setSettingsHistory] = useState([]);
  // Valores padrão para regras, pontuação e desempate (usados se não houver conteúdo salvo)
  const initialBet = settings?.betValue != null ? settings.betValue : 15;
  const initialBetDisplay = Number(initialBet).toFixed(2).replace('.', ',');
  const DEFAULT_RULES_MD = `**Participação**\n- Faça seus palpites antes do início das partidas.\n- Valor por cartela: R$ ${initialBetDisplay}.\n- Somente cartelas pagas entram no ranking e na premiação.\n\n**Premiação**\n- 85% do total pago na rodada compõe o prêmio.\n- Dividido igualmente entre os vencedores com maior pontuação.`;
  const DEFAULT_SCORING_MD = `- Placar exato: **3 pontos**.\n- Resultado correto (vitória/empate): *1 ponto*.`;
  const DEFAULT_TIEBREAK_MD = `- Posição igual para empates em pontos.\n- Premiação dividida igualmente entre empatados no topo.`;
  const [rulesText, setRulesText] = useState(settings?.rulesText ?? DEFAULT_RULES_MD);
  const [scoringCriteria, setScoringCriteria] = useState(settings?.scoringCriteria ?? DEFAULT_SCORING_MD);
  const [tiebreakRules, setTiebreakRules] = useState(settings?.tiebreakRules ?? DEFAULT_TIEBREAK_MD);
  const [expandedAdminRounds, setExpandedAdminRounds] = useState({});
  const rulesTextareaRef = useRef(null);
  const saveTimerRef = useRef(null);
  const initialLoadRef = useRef(true);

  const toggleAdminRound = (roundId) => {
    setExpandedAdminRounds(prev => ({ ...prev, [roundId]: !prev[roundId] }));
  };

  // Selecionar automaticamente a rodada mais recente no dashboard
  useEffect(() => {
    const dashboardRounds = rounds.filter(r => r.status === 'finished' || r.status === 'closed');
    const toTs = (r) => {
      if (r?.closeAt) {
        const t = new Date(r.closeAt).getTime();
        if (!isNaN(t)) return t;
      }
      const ca = r?.createdAt;
      if (ca && typeof ca.toDate === 'function') {
        return ca.toDate().getTime();
      }
      if (ca && typeof ca === 'object' && typeof ca.seconds === 'number') {
        return ca.seconds * 1000;
      }
      return typeof r?.number === 'number' ? r.number : 0;
    };
    if (dashboardRounds.length > 0) {
      const latestRound = dashboardRounds.sort((a, b) => toTs(b) - toTs(a))[0];
      if (selectedDashboardRound !== latestRound.id) {
        setSelectedDashboardRound(latestRound.id);
      }
    }
  }, [rounds]);

  useEffect(() => {
    const loadHistory = async () => {
      try {
        // Filtra pelo bolão: sem isso a consulta traz o histórico de todos e a
        // regra recusa a leitura inteira, deixando o dono sem histórico nenhum.
        const q = query(
          collection(db, 'settings_history'),
          where('tenantId', '==', tenantId),
          orderBy('createdAt', 'desc'),
          limit(10)
        );
        const snap = await getDocs(q);
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setSettingsHistory(items);
      } catch (err) {
        console.warn('Falha ao carregar histórico:', err);
      }
    };
    loadHistory();
  }, [settings, tenantId]);

  // Helpers de formatação (Markdown simples)
  const wrapSelection = (start, end) => {
    const ta = rulesTextareaRef.current;
    if (!ta) return;
    const ss = ta.selectionStart || 0;
    const se = ta.selectionEnd || ss;
    const val = rulesText || '';
    const selected = val.slice(ss, se);
    const newVal = val.slice(0, ss) + start + selected + end + val.slice(se);
    setRulesText(newVal);
    initialLoadRef.current = false;
    setTimeout(() => {
      ta.focus();
      ta.selectionStart = ss + start.length;
      ta.selectionEnd = se + start.length;
    }, 0);
  };

  const makeList = (ordered) => {
    const ta = rulesTextareaRef.current;
    const val = rulesText || '';
    let ss = 0, se = val.length;
    if (ta) { ss = ta.selectionStart || 0; se = ta.selectionEnd || ss; }
    const selected = val.slice(ss, se) || '';
    const block = selected || val;
    const lines = block.split('\n');
    const newBlock = lines.map((l, i) => {
      const prefix = ordered ? `${i + 1}. ` : '- ';
      return l ? prefix + l : prefix;
    }).join('\n');
    const newVal = val.slice(0, ss) + newBlock + val.slice(se);
    setRulesText(newVal);
    initialLoadRef.current = false;
  };

  useEffect(() => {
    console.log('Settings atualizados:', settings);
    // WhatsApp
    if (settings?.whatsappMessage) {
      console.log('Carregando mensagem WhatsApp:', settings.whatsappMessage);
      setWhatsappMessage(settings.whatsappMessage);
    } else if (settings && !settings.whatsappMessage) {
      console.log('Usando mensagem padrão');
      setWhatsappMessage('🏆 *BOLÃO BRASILEIRÃO 2026*\n\n📋 *{RODADA}*\n🎫 *Cartela: {CARTELA}*\n✅ Confirmado!\n\n{PALPITES}\n\n🏦 Pagamento via PIX\n🔑 Chave: {PIX}\n👤 Destinatário: {DESTINATARIO}\n\n💰 R$ 15,00\n⚠️ *Não pode alterar após pagamento*\n\nBoa sorte! 🍀');
    }

    // Bet value
    if (settings?.betValue) {
      console.log('Carregando valor da aposta:', settings.betValue);
      setBetValue(settings.betValue);
    }

    // Charge template
    if (settings?.chargeMessageTemplate != null) {
      setChargeMessageTemplate(settings.chargeMessageTemplate);
    }

    // Devolution API fields
    setDevolutionLink(settings?.devolution?.link || '');
    setDevolutionInstance(settings?.devolution?.instanceName || '');
    setDevolutionToken(settings?.devolution?.token || '');
    // Atualiza estados de manutenção quando settings muda
    setMaintenanceMode(!!settings?.maintenanceMode);
    setMaintenanceMessage(settings?.maintenanceMessage || 'Estamos realizando uma manutenção programada para melhorar sua experiência. Por favor, tente novamente em breve.');
    setMaintenanceUntilInput(settings?.maintenanceUntil ? new Date(settings.maintenanceUntil).toISOString().slice(0, 16) : '');

    // Prefill regras/scoring/desempate mesmo sem settings (usando valor efetivo)
    const effectiveBet = settings?.betValue != null ? settings.betValue : (betValue != null ? Number(betValue) : 15);
    const betDisplay = Number(effectiveBet).toFixed(2).replace('.', ',');
    const defaultRulesMd = `**Participação**\n- Faça seus palpites antes do início das partidas.\n- Valor por cartela: R$ ${betDisplay}.\n- Somente cartelas pagas entram no ranking e na premiação.\n\n**Premiação**\n- 85% do total pago na rodada compõe o prêmio.\n- Dividido igualmente entre os vencedores com maior pontuação.`;
    const defaultScoringMd = `- Placar exato: **3 pontos**.\n- Resultado correto (vitória/empate): *1 ponto*.`;
    const defaultTiebreakMd = `- Posição igual para empates em pontos.\n- Premiação dividida igualmente entre empatados no topo.`;

    if (settings) {
      setRulesText(settings.rulesText ?? (rulesText || defaultRulesMd));
      setScoringCriteria(settings.scoringCriteria ?? (scoringCriteria || defaultScoringMd));
      setTiebreakRules(settings.tiebreakRules ?? (tiebreakRules || defaultTiebreakMd));
    } else {
      // Sem settings (ex.: offline/erro Firestore) — preencher somente se estiver vazio
      if (!rulesText) setRulesText(defaultRulesMd);
      if (!scoringCriteria) setScoringCriteria(defaultScoringMd);
      if (!tiebreakRules) setTiebreakRules(defaultTiebreakMd);
    }
  }, [settings]);

  // Auto-save das regras com debounce
  useEffect(() => {
    if (initialLoadRef.current) return; // ignora auto-save do carregamento inicial
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      updateSettings({
        rulesText,
        scoringCriteria,
        tiebreakRules
      }).catch(err => console.error('Erro ao auto-salvar regras:', err));
    }, 600);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [rulesText, scoringCriteria, tiebreakRules]);



  const handleDeleteUser = async (user) => {
    if (!confirm(`⚠️ ATENÇÃO!\n\nDeseja realmente excluir o usuário "${user.name}"?\n\nIsso também excluirá todos os palpites deste usuário!\n\nEsta ação não pode ser desfeita.`)) {
      return;
    }
    try {
      // Um lote em vez de uma ida ao servidor por palpite: apagar 40 cartelas
      // eram 40 requisicoes em fila, e a interface congelava enquanto isso.
      const userPredictions = predictions.filter(p => p.userId === user.id);
      for (let i = 0; i < userPredictions.length; i += 400) {
        const lote = writeBatch(db);
        userPredictions.slice(i, i + 400).forEach(pred => lote.delete(doc(db, 'predictions', pred.id)));
        await lote.commit();
      }
      await deleteUser(user.id);
      alert('✅ Usuário excluído com sucesso!');
    } catch (error) {
      alert('❌ Erro ao excluir usuário: ' + error.message);
    }
  };

  const togglePaymentStatus = async (userId, roundId, cartelaCode) => {
    try {
      const cartelaPredictions = predictions.filter(p => 
        p.userId === userId && 
        p.roundId === roundId && 
        (p.cartelaCode || 'ANTIGA') === cartelaCode
      );
      
      if (cartelaPredictions.length === 0) return;
      
      const newPaidStatus = !cartelaPredictions[0].paid;
      
      const lote = writeBatch(db);
      cartelaPredictions.forEach(pred => lote.update(doc(db, 'predictions', pred.id), {
        paid: newPaidStatus,
        statusPagamento: newPaidStatus ? 'pago' : 'pendente',
      }));
      await lote.commit();

      try {
        await addDoc(collection(db, 'admin_events'), {
          tenantId,
          adminId: currentUser?.id || null,
          type: 'payment_status_changed',
          targetUserId: userId,
          roundId,
          cartelaCode,
          newStatus: newPaidStatus,
          createdAt: serverTimestamp()
        });
      } catch (logErr) {
        console.warn('Falha ao registrar log de pagamento:', logErr);
      }
    } catch (error) {
      alert('Erro ao atualizar pagamento: ' + error.message);
    }
  };

  const getPaymentStatus = (userId, roundId, cartelaCode = null) => {
    if (cartelaCode) {
      const cartela = predictions.find(p => 
        p.userId === userId && 
        p.roundId === roundId && 
        (p.cartelaCode || 'ANTIGA') === cartelaCode
      );
      return cartela?.paid || false;
    }
    
    const userRoundPrediction = predictions.find(p => p.userId === userId && p.roundId === roundId);
    return userRoundPrediction?.paid || false;
  };

  const getRoundParticipants = (roundId) => {
    const participantData = {};
    
    predictions.filter(p => p.roundId === roundId).forEach(pred => {
      const key = `${pred.userId}-${pred.cartelaCode || 'ANTIGA'}`;
      if (!participantData[key]) {
        participantData[key] = {
          userId: pred.userId,
          cartelaCode: pred.cartelaCode || 'ANTIGA',
          establishmentId: pred.establishmentId || null,
          paid: pred.paid || false
        };
      }
    });
    
    return Object.values(participantData);
  };

  const getRoundFinancialSummary = (roundId, filterEstablishmentId = null, showTotalPrize = false) => {
    const betValue = settings?.betValue || 15;
    let participants = getRoundParticipants(roundId);
    
    const allParticipants = showTotalPrize ? getRoundParticipants(roundId) : participants;
    
    if (filterEstablishmentId && filterEstablishmentId !== 'all') {
      participants = participants.filter(p => p.establishmentId === filterEstablishmentId);
    }
    
    const totalParticipations = participants.length;
    const paidCount = participants.filter(p => p.paid).length;
    const pendingCount = totalParticipations - paidCount;
    const totalExpected = totalParticipations * betValue;
    const totalReceived = paidCount * betValue;
    const totalPending = pendingCount * betValue;

    // Calcular sobre TODOS os participantes pagos
    const allPaidCount = allParticipants.filter(p => p.paid).length;
    const totalReceivedAll = allPaidCount * betValue;
    
    // Premiação e Admin são sobre o TOTAL. Os percentuais são os que o
    // organizador escolheu em Configurações — antes o cálculo ignorava a
    // escolha dele e usava 85/10/5 fixos.
    const pcts = percentuaisDe(settings);
    const { premio: prizePool, administracao: adminFee } = rateio(totalReceivedAll, pcts);
    
    // Comissão do estabelecimento: 5% APENAS dos palpites vinculados a ele
    let establishmentFee = 0;
    if (filterEstablishmentId && filterEstablishmentId !== 'all' && filterEstablishmentId !== 'none') {
      // Se filtrou um estabelecimento específico, mostrar só a comissão dele
      const estParticipants = allParticipants.filter(p => p.establishmentId === filterEstablishmentId && p.paid);
      establishmentFee = estParticipants.length * betValue * (pcts.estabelecimentoPct / 100);
    } else {
      // Se não filtrou ou filtrou "todos", somar comissões de TODOS os estabelecimentos
      const paidParticipants = allParticipants.filter(p => p.paid);
      establishmentFee = paidParticipants.reduce((sum, p) => {
        return p.establishmentId ? sum + (betValue * (pcts.estabelecimentoPct / 100)) : sum;
      }, 0);
    }

    return {
      totalParticipations,
      paidCount,
      pendingCount,
      totalExpected,
      totalReceived,
      totalPending,
      prizePool,
      adminFee,
      establishmentFee,
      betValue
    };
  };

  const getEstablishmentCommission = (roundId, establishmentId) => {
    const estParticipants = getRoundParticipants(roundId).filter(p => p.establishmentId === establishmentId && p.paid);
    const totalPaid = estParticipants.length * 15;
    return totalPaid * 0.05; // 5% de comissão
  };

  const getTotalFinancialSummary = () => {
    const betValue = settings?.betValue || 15;
    const finishedAndClosedRounds = rounds.filter(r => r.status === 'finished' || r.status === 'closed');
    let totalExpected = 0;
    let totalReceived = 0;
    let totalPending = 0;

    finishedAndClosedRounds.forEach(round => {
      const summary = getRoundFinancialSummary(round.id);
      totalExpected += summary.totalExpected;
      totalReceived += summary.totalReceived;
      totalPending += summary.totalPending;
    });

    const pcts = percentuaisDe(settings);
    const { premio: prizePool, administracao: adminFee } = rateio(totalReceived, pcts);

    // Calcular comissão total somando todas as rodadas
    let establishmentFee = 0;
    finishedAndClosedRounds.forEach(round => {
      const participants = getRoundParticipants(round.id).filter(p => p.paid);
      establishmentFee += participants.reduce((sum, p) => {
        return p.establishmentId ? sum + (betValue * (pcts.estabelecimentoPct / 100)) : sum;
      }, 0);
    });

    return {
      totalExpected,
      totalReceived,
      totalPending,
      prizePool,
      adminFee,
      establishmentFee
    };
  };

  const handleSaveRules = async () => {
    try {
      await updateSettings({
        rulesText,
        scoringCriteria,
        tiebreakRules
      });
      alert('✅ Regras atualizadas com sucesso!');
    } catch (error) {
      alert('❌ Erro ao salvar regras: ' + error.message);
    }
  };

  const getRoundDashboardData = (roundId) => {
    if (!roundId) return null;
    
    const round = rounds.find(r => r.id === roundId);
    if (!round || (round.status !== 'finished' && round.status !== 'closed')) return null;

    const betValue = settings?.betValue || 15;
    const participants = getRoundParticipants(roundId);
    const paidParticipations = participants.filter(p => p.paid);
    
    const totalPaid = paidParticipations.length * betValue;
    const pcts = percentuaisDe(settings);
    const { premio: prizePool, administracao: adminFee } = rateio(totalPaid, pcts);

    // Calcular comissão total dos estabelecimentos (soma individual)
    const establishmentFee = paidParticipations.reduce((sum, p) => {
      return p.establishmentId ? sum + (betValue * (pcts.estabelecimentoPct / 100)) : sum;
    }, 0);

    const ranking = paidParticipations.map(participant => {
      const user = users.find(u => u.id === participant.userId);
      if (!user) return null;
      
      const points = calculateUserRoundPoints(participant.userId, roundId, participant.cartelaCode);
      
      return { 
        user, 
        cartelaCode: participant.cartelaCode,
        establishmentId: participant.establishmentId,
        points 
      };
    }).filter(Boolean).sort((a, b) => b.points - a.points);

    let winners = [];
    let prizePerWinner = 0;
    if (round.status === 'finished') {
      const maxPoints = ranking.length > 0 ? ranking[0].points : 0;
      winners = ranking.filter(r => r.points === maxPoints);
      prizePerWinner = winners.length > 0 ? prizePool / winners.length : 0;
    }

    return {
      round,
      totalParticipations: participants.length,
      paidCount: paidParticipations.length,
      totalPaid,
      prizePool,
      adminFee,
      establishmentFee,
      winners,
      prizePerWinner,
      ranking,
      betValue
    };
  };

  const calculateUserRoundPoints = (userId, roundId, cartelaCode = null) => {
    const round = rounds.find(r => r.id === roundId);
    if (!round || (round.status !== 'finished' && round.status !== 'closed')) return 0;
    
    if (cartelaCode) {
      const cartelaPreds = predictions.filter(p => 
        p.userId === userId && 
        p.roundId === roundId && 
        p.cartelaCode === cartelaCode
      );
      
      if (cartelaPreds.length === 0) return 0;
      const isPaid = cartelaPreds[0]?.paid;
      if (!isPaid) return 0;
      
      // Regra e escala vêm de api/_shared/scoring.js e matchStatus.js: painel,
      // participante, crons e página pública precisam somar igual.
      let points = 0;
      round.matches?.forEach(match => {
        const pred = cartelaPreds.find(p => p.matchId === match.id);
        if (!pred || !matchCountsForScoring(match)) return;
        points += calcPoints(pred.homeScore, pred.awayScore, match.homeScore, match.awayScore);
      });
      return points;
    }

    const userRoundPreds = predictions.filter(p => p.userId === userId && p.roundId === roundId);
    const cartelaCodes = [...new Set(userRoundPreds.map(p => p.cartelaCode || 'ANTIGA'))];

    return cartelaCodes.reduce((sum, code) => {
      return sum + calculateUserRoundPoints(userId, roundId, code);
    }, 0);
  };

  // Cache do dashboard data para melhorar performance
  const dashboardData = useMemo(() => {
    return getRoundDashboardData(selectedDashboardRound);
  }, [selectedDashboardRound, rounds, predictions, users, settings]);

  // Abrir modal de palpites do participante no Admin
  const openAdminPlayerModal = (roundId, item) => {
    const round = rounds.find(r => r.id === roundId);
    if (!round) return;
    const preds = predictions.filter(p => p.userId === item.user.id && p.roundId === roundId && (p.cartelaCode || 'ANTIGA') === item.cartelaCode);
    if (preds.length === 0) return;
    const cartela = {
      code: item.cartelaCode,
      predictions: preds,
      establishmentId: preds[0]?.establishmentId || null,
      paid: preds[0]?.paid || false
    };
    setAdminPlayerModal({ round, item, cartela });
  };

  const [isSendingCharges, setIsSendingCharges] = useState(false);
  const [commsMessage, setCommsMessage] = useState('');
  const [commSelectedTemplateKey, setCommSelectedTemplateKey] = useState('');
  const [selectedCommUserId, setSelectedCommUserId] = useState('');
  const [selectedCommRound, setSelectedCommRound] = useState(null);
  const [commPaymentFilter, setCommPaymentFilter] = useState('all');
  const [isSendingMassComms, setIsSendingMassComms] = useState(false);
  const [selectAllCommUsers, setSelectAllCommUsers] = useState(false);
  const [commSelectedUserIds, setCommSelectedUserIds] = useState([]);
  const selectAllCommRef = useRef(null);
  const [isSendingSingleComm, setIsSendingSingleComm] = useState(false);
  const [isSendingGroupComm, setIsSendingGroupComm] = useState(false);
  const [commFeedback, setCommFeedback] = useState(null); // { type: 'success'|'error', text }
  const [commDeadline, setCommDeadline] = useState('');
  const [commResultsDate, setCommResultsDate] = useState('');
  const [commPdfUrl, setCommPdfUrl] = useState('');
  const [commAppLink, setCommAppLink] = useState(typeof window !== 'undefined' ? window.location.origin : '');
  const [commActiveTab, setCommActiveTab] = useState('envio');
  const [commsDelayMs, setCommsDelayMs] = useState(1200);

  // Automatiza prazo final (closeAt), divulgação (createdAt) e link de ranking
  useEffect(() => {
    try {
      const round = selectedCommRound ? rounds.find(r => r.id === selectedCommRound) : null;
      const deadline = formatPtBrFlexible(round?.closeAt) || '';
      const publish = formatPtBrFlexible(round?.createdAt) || '';
      const rankingUrl = buildRankingLink(round?.id) || '';
      setCommDeadline(deadline);
      setCommResultsDate(publish);
      setCommPdfUrl(rankingUrl);
    } catch {}
  }, [selectedCommRound, rounds, commAppLink]);

  // Atualiza estado visual (indeterminate) do checkbox "Selecionar todos"
  useEffect(() => {
    if (!selectAllCommRef.current) return;
    const eligible = (users || []).filter(u => !u.isAdmin && !!u.whatsapp);
    const isMixed = selectAllCommUsers && commSelectedUserIds.length > 0 && commSelectedUserIds.length < eligible.length;
    selectAllCommRef.current.indeterminate = isMixed;
  }, [selectAllCommUsers, commSelectedUserIds, users]);

  const formatPhoneBR = (phone) => {
    let formatted = (phone || '').replace(/\D/g, '');
    if (!formatted.startsWith('55')) formatted = '55' + formatted;
    return formatted;
  };

  const formatChargeMessage = (userName, roundName, amount, cartelaCode) => {
    const tpl = chargeMessageTemplate || 'Olá {NOME},\n\nIdentificamos que o pagamento da sua cartela da {RODADA} ainda está pendente.\n\nValor: R$ {VALOR}\nCartela: {CARTELA}\n\nPor favor, conclua o pagamento para validar sua participação no ranking e na premiação. Obrigado! 🙏';
    return tpl
      .replace('{NOME}', userName || '')
      .replace('{RODADA}', roundName || '')
      .replace('{VALOR}', Number(amount || settings?.betValue || 15).toFixed(2))
      .replace('{CARTELA}', cartelaCode || '');
  };

  // Envia texto via EvolutionAPI
  const sendTextViaEvolution = async (phoneNumber, text) => {
    let base = devolutionLink || settings?.devolution?.link;
    let instance = devolutionInstance || settings?.devolution?.instanceName;
    const token = devolutionToken || settings?.devolution?.token;
    if (!base || !instance || !token) {
      throw new Error('EvolutionAPI não configurada. Defina link, instância e token em Configurações.');
    }

    // Decide caminho: proxy em produção (evita erro de certificado no navegador), direto no DEV
    const isBrowser = typeof window !== 'undefined';
    const host = isBrowser ? window.location.hostname : '';
    const isLocal = /^(localhost|127\.0\.0\.1)$/.test(host);
    const useProxy = isBrowser && !isLocal;

    // Sanitização: remover espaços, barras/ pontos finais, e forçar HTTPS (para chamada direta)
    let cleanBase = (base || '').trim().replace(/\/$/, '').replace(/\.$/, '');
    let cleanInstance = (instance || '').trim().replace(/\.$/, '');



    const directUrl = `${cleanBase}/message/sendText/${encodeURIComponent(cleanInstance)}`;

    try {
      if (useProxy) {
        // Usa função serverless para contornar TLS inválido no cliente
        const res = await fetch('/api/evolution/sendText', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ number: phoneNumber, text, link: base, instance, token })
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`Falha EvolutionAPI via proxy: ${res.status} ${body}`);
        }
        const data = await res.json().catch(() => null);
        return data;
      } else {
        // Chamado diretamente no DEV
        const res = await fetch(directUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': token
          },
          body: JSON.stringify({ number: phoneNumber, text })
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`Falha EvolutionAPI: ${res.status} ${body}`);
        }
        const data = await res.json().catch(() => null);
        return data;
      }
    } catch (err) {
      const target = useProxy ? 'via proxy /api' : directUrl;
      throw new Error(`Falha ao conectar à EvolutionAPI (${target}). Verifique o host, HTTPS e CSP. Detalhe: ${err?.message || 'erro de rede'}`);
    }
  };

  const sendTextToGroup = async (text) => {
    const groupJid = (settings?.whatsapp?.groupJid || whatsappGroupJid || '').trim();
    if (!groupJid) {
      throw new Error('JID do grupo WhatsApp não configurado. Defina em Configurações → WhatsApp → Grupo.');
    }
    return sendTextViaEvolution(groupJid, text);
  };

  const buildResultGroupMessage = (roundId) => {
    const data = getRoundDashboardData(roundId);
    if (!data) return null;
    const { round, winners, prizePerWinner, paidCount, ranking } = data;

    const winnerNames = winners.map(w => w.user?.name || '').filter(Boolean).join(', ');
    const prize = prizePerWinner > 0 ? `R$ ${prizePerWinner.toFixed(2)}` : '';

    const sortedRounds = [...rounds].sort((a, b) => (a.number || 0) - (b.number || 0));
    const nextRound = sortedRounds.find(
      r => (r.number || 0) > (round.number || 0) && (r.status === 'upcoming' || r.status === 'open')
    );

    let msg = `🏆 *BOLÃO BRASILEIRÃO — ${round.name || 'Rodada'} ENCERRADA!*\n\n`;

    if (winners.length === 1) {
      msg += `🥇 *Parabéns ao campeão: ${winnerNames}!*\n`;
    } else if (winners.length > 1) {
      msg += `🥇 *Parabéns aos campeões: ${winnerNames}!*\n`;
    }

    if (prize && winners.length > 0) {
      msg += `💰 Prêmio: *${prize}*${winners.length > 1 ? ' cada' : ''}\n`;
    }

    msg += `\n📊 Participantes: *${paidCount}*\n`;

    if (ranking.length > 0) {
      msg += `\n🏅 *Top 3:*\n`;
      const medals = ['🥇', '🥈', '🥉'];
      ranking.slice(0, 3).forEach((r, i) => {
        msg += `${medals[i] || `${i + 1}.`} ${r.user?.name || '?'} — ${r.points} pts\n`;
      });
    }

    msg += `\n🙏 Obrigado a todos que participaram!`;

    if (nextRound) {
      msg += `\n\n📢 *Próxima: ${nextRound.name}* — em breve!\nFique de olho e faça seus palpites. ⚽`;
    }

    return msg;
  };

  const sendChargeWhatsApp = async (userId, cartelaCode) => {
    try {
      const user = users.find(u => u.id === userId);
      if (!user?.whatsapp) throw new Error('Usuário sem WhatsApp');
      const round = rounds.find(r => r.id === selectedFinanceRound);
      const amount = settings?.betValue || 15;
      const message = formatChargeMessage(user.name, round?.name, amount, cartelaCode);
      const phone = formatPhoneBR(user.whatsapp);
      const result = await sendTextViaEvolution(phone, message);

      if (addCommunication) {
        await addCommunication({
          type: 'charge',
          userId: user.id,
          roundId: selectedFinanceRound,
          cartelaCode,
          amount,
          message,
          channel: 'whatsapp',
          status: 'sent',
          createdBy: currentUser?.id || null
        });
      }
      alert(`Cobrança enviada para ${user.name}.`);
    } catch (err) {
      console.error('Erro ao enviar cobrança:', err);
      alert('Erro ao iniciar cobrança: ' + err.message);
      if (addCommunication) {
        try {
          await addCommunication({
            type: 'charge',
            userId,
            roundId: selectedFinanceRound,
            cartelaCode,
            amount: settings?.betValue || 15,
            message: 'Falha: ' + (err?.message || 'erro desconhecido'),
            channel: 'whatsapp',
            status: 'error',
            createdBy: currentUser?.id || null
          });
        } catch {}
      }
    }
  };

  const sendGeneralCommunication = async () => {
    try {
      setIsSendingSingleComm(true);
      const user = users.find(u => u.id === selectedCommUserId);
      if (!user) throw new Error('Selecione um destinatário');
      if (!user.whatsapp) throw new Error('Destinatário sem WhatsApp');
      const base = commsMessage || '';
      const ctx = { ...getTemplateContext(), userName: user.name || '' };
      const message = compileTemplate(base, ctx);
      const phone = formatPhoneBR(user.whatsapp);
      await sendTextViaEvolution(phone, message);

      if (addCommunication) {
        await addCommunication({
          type: 'communication',
          userId: user.id,
          message,
          channel: 'whatsapp',
          status: 'sent',
          createdBy: currentUser?.id || null
        });
      }
      setCommFeedback({ type: 'success', text: `Mensagem enviada para ${user.name}.` });
      setTimeout(() => setCommFeedback(null), 2000);
    } catch (err) {
      console.error('Erro ao enviar comunicado:', err);
      setCommFeedback({ type: 'error', text: 'Erro ao enviar comunicado: ' + err.message });
      setTimeout(() => setCommFeedback(null), 3000);
      if (addCommunication && selectedCommUserId) {
        try {
          await addCommunication({
            type: 'communication',
            userId: selectedCommUserId,
            message: 'Falha: ' + (err?.message || 'erro desconhecido'),
            channel: 'whatsapp',
            status: 'error',
            createdBy: currentUser?.id || null
          });
        } catch {}
      }
    } finally {
      setIsSendingSingleComm(false);
    }
  };

  const getEligibleCommUsers = () => {
    if (selectAllCommUsers) {
      return (users || []).filter(u => !u.isAdmin && !!u.whatsapp);
    }
    if (!selectedCommRound) return [];
    const list = getRoundParticipants(selectedCommRound) || [];
    return list
      .filter(p => {
        const u = users.find(x => x.id === p.userId);
        if (!u?.whatsapp) return false;
        if (commPaymentFilter === 'paid') return !!p.paid;
        if (commPaymentFilter === 'pending') return !p.paid;
        return true;
      })
      .map(p => users.find(x => x.id === p.userId))
      .filter(Boolean);
  };

  const handleToggleSelectAllComm = (checked) => {
    setSelectAllCommUsers(checked);
    if (checked) {
      const eligible = (users || []).filter(u => !u.isAdmin && !!u.whatsapp);
      setCommSelectedUserIds(eligible.map(u => u.id));
      setSelectedCommUserId('');
    } else {
      setCommSelectedUserIds([]);
    }
  };

  const toggleCommUser = (userId, checked) => {
    setCommSelectedUserIds(prev => {
      const set = new Set(prev);
      if (checked) set.add(userId); else set.delete(userId);
      return Array.from(set);
    });
  };

  const getCommRecipients = () => {
    if (selectAllCommUsers) {
      const eligible = (users || []).filter(u => !u.isAdmin && !!u.whatsapp);
      const sel = new Set(commSelectedUserIds);
      return eligible
        .filter(u => sel.has(u.id))
        .map(u => ({ userId: u.id, paid: false }));
    }
    if (!selectedCommRound) return [];
    const list = getRoundParticipants(selectedCommRound) || [];
    return list.filter(p => {
      const u = users.find(x => x.id === p.userId);
      if (!u?.whatsapp) return false;
      if (commPaymentFilter === 'paid') return !!p.paid;
      if (commPaymentFilter === 'pending') return !p.paid;
      return true;
    });
  };

  const sendMassCommunications = async () => {
    try {
      const recipients = getCommRecipients();
      if (!commsMessage) throw new Error('Digite a mensagem a enviar.');
      if (recipients.length === 0) throw new Error('Nenhum destinatário selecionado.');
      setIsSendingMassComms(true);
      let okCount = 0;
      let failCount = 0;
      for (const p of recipients) {
        const user = users.find(u => u.id === p.userId);
        const ctx = { ...getTemplateContext(), userName: user?.name || '' };
        const msg = compileTemplate(commsMessage || '', ctx);
        const phone = formatPhoneBR(user.whatsapp);
        try {
          await sendTextViaEvolution(phone, msg);
          okCount++;
          if (addCommunication) {
            await addCommunication({ type: 'communication', userId: user.id, roundId: selectAllCommUsers ? null : selectedCommRound, message: msg, channel: 'whatsapp', status: 'sent', createdBy: currentUser?.id || null });
          }
        } catch (e) {
          failCount++;
          if (addCommunication) {
            try { await addCommunication({ type: 'communication', userId: user.id, roundId: selectAllCommUsers ? null : selectedCommRound, message: 'Falha: ' + (e?.message || 'erro'), channel: 'whatsapp', status: 'error', createdBy: currentUser?.id || null }); } catch {}
          }
        }
        await new Promise(r => setTimeout(r, commsDelayMs));
      }
      alert(`Envio concluído: ${okCount} sucesso, ${failCount} falhas.`);
    } catch (err) {
      alert('Erro no envio em massa: ' + err.message);
    } finally {
      setIsSendingMassComms(false);
    }
  };

  const getBrandName = () => (settings?.brandName || 'Bolão Brasileiro 2026');

  // Formata datas vindas como string ISO ou Firestore Timestamp
  const formatPtBrFlexible = (value) => {
    try {
      if (!value) return '';
      let dt = null;
      if (value && typeof value.toDate === 'function') dt = value.toDate();
      else if (value && typeof value === 'object' && typeof value.seconds === 'number') dt = new Date(value.seconds * 1000);
      else dt = new Date(value);
      if (isNaN(dt.getTime())) return '';
      return dt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
    } catch {
      return '';
    }
  };

  const buildRankingLink = (roundId) => {
    const base = commAppLink || (typeof window !== 'undefined' ? window.location.origin : '');
    if (!roundId) return base;
    const url = new URL(base);
    // Preserva host e esquema, força query para ranking da rodada
    url.searchParams.set('view', 'user');
    url.searchParams.set('tab', 'ranking');
    url.searchParams.set('round', roundId);
    return url.toString();
  };

  const getTemplateContext = () => {
    const fallbackRound = !selectedCommRound
      ? (rounds.find(r => r.status === 'open')
        || rounds.find(r => r.status === 'upcoming')
        || ([...rounds].sort((a, b) => ((b?.number ?? 0) - (a?.number ?? 0)))[0])
        || null)
      : null;
    const round = selectedCommRound ? rounds.find(r => r.id === selectedCommRound) : fallbackRound;
    const roundName = round?.name || 'Rodada';
    const user = selectedCommUserId ? users.find(u => u.id === selectedCommUserId) : null;
    const userName = user?.name || '{NOME}';
    const link = commAppLink || (typeof window !== 'undefined' ? window.location.origin : '');
    const deadline = round?.closeAt ? formatPtBrFlexible(round?.closeAt) : '{LIMITE}';
    const publish = round?.createdAt ? formatPtBrFlexible(round?.createdAt) : '{DIVULGACAO}';
    const ranking = round?.id ? buildRankingLink(round?.id) : '{RANKING_URL}';
    const brand = getBrandName();
    // Inclui também chaves em maiúsculas esperadas pelos templates
    return {
      roundName,
      userName,
      link,
      deadline,
      publish,
      ranking,
      brand,
      RODADA: roundName,
      NOME: userName,
      LINK: link,
      LIMITE: deadline,
      DIVULGACAO: publish,
      RANKING_URL: ranking,
      BRAND: brand
    };
  };

  const buildTemplateText = (key, mode = 'rich') => {
    const context = getTemplateContext();
    return buildTemplateTextUtil(key, mode, context);
  };

  const applyTemplate = (key, mode = 'rich') => {
    const round = selectedCommRound ? rounds.find(r => r.id === selectedCommRound) : null;
    if (key === 'final-result') {
      if (!round || round.status !== 'finished') {
        alert('Apenas rodadas com status "Finalizada" permitem gerar o Resultado Final.');
        return;
      }
    }
    const text = buildTemplateText(key, mode);
    setCommsMessage(text);
    setCommSelectedTemplateKey(key);
  };

  const copyTemplate = async (key, mode = 'plain') => {
    try {
      const text = buildTemplateText(key, mode);
      await navigator.clipboard.writeText(text);
      alert('Texto copiado para a área de transferência.');
    } catch (e) {
      alert('Não foi possível copiar o texto.');
    }
  };

  const handleSaveWhatsAppMessage = async () => {
    try {
      // validações básicas
      
      const dataToSave = {
        whatsappMessage: whatsappMessage,
        betValue: parseFloat(betValue),
        chargeMessageTemplate: chargeMessageTemplate,
        devolution: {
          link: devolutionLink,
          instanceName: devolutionInstance,
          token: devolutionToken
        },
        maintenanceMode: !!maintenanceMode,
        maintenanceMessage: maintenanceMessage,
        maintenanceUntil: maintenanceUntilInput ? Date.parse(maintenanceUntilInput) : null,
        maintenanceAllowedIps: (maintenanceAllowedIps || '').split(',').map(s => s.trim()).filter(Boolean),
        maintenanceSchedule: {
          start: maintenanceScheduleStart ? Date.parse(maintenanceScheduleStart) : null,
          end: maintenanceScheduleEnd ? Date.parse(maintenanceScheduleEnd) : null
        },
        whatsapp: {
          provider: whatsappProvider,
          apiToken: whatsappApiToken,
          number: whatsappNumber,
          groupJid: whatsappGroupJid.trim(),
          notifyEnabled: !!whatsappNotifyEnabled,
          notifyEvents: whatsappNotifyEvents,
          defaultTemplates: { confirm: whatsappMessage, charge: chargeMessageTemplate }
        },
        betConfig: {
          minBet: parseFloat(minBet) || null,
          maxBet: parseFloat(maxBet) || null,
          bonus: { enabled: !!bonusEnabled, percent: parseFloat(bonusPercent) || 0 },
          fees: { adminPercent: parseFloat(adminFeePercent) || 10, establishmentPercent: parseFloat(establishmentPercent) || 5 },
          typesLimitsText: limitsByTypeText || ''
        },
        payment: {
          provider: paymentProvider,
          methods: { pix: !!paymentPixEnabled, card: !!paymentCardEnabled },
          transactionFeePercent: parseFloat(transactionFeePercent) || 0,
          allowedIps: (paymentAllowedIps || '').split(',').map(s => s.trim()).filter(Boolean),
          signatureHeaderName,
          retries: parseInt(paymentRetries) || 3,
          timeoutMs: parseInt(paymentTimeoutMs) || 10000
        },
        woovi: { appId: wooviAppId.trim(), webhookSecret: wooviWebhookSecret.trim() },
        footballApi: { key: footballApiKey.trim() },
        abTests: {
          enabled: !!abTestsEnabled,
          experiments: { newDashboard: Number(experimentDashboardPercent) || 0, paymentFlowV2: Number(experimentPaymentFlowPercent) || 0 }
        },
        rulesText,
        scoringCriteria,
        tiebreakRules,
        termsOfUse,
        systemPolicies,
        limitsRestrictions,
        complianceConfig
      };

      // Buscar o documento de settings
      const settingsSnapshot = await getDocs(query(collection(db, 'settings'), where('tenantId', '==', tenantId)));
      let settingsId = null;
      if (settingsSnapshot.empty) {
        const docRef = await addDoc(collection(db, 'settings'), { ...dataToSave, tenantId, createdAt: serverTimestamp() });
        settingsId = docRef.id;
      } else {
        settingsId = settingsSnapshot.docs[0].id;
        await updateDoc(doc(db, 'settings', settingsId), dataToSave);
      }

      // Log de manutenção (toggle)
      try {
        const prevMaintenance = !!settings?.maintenanceMode;
        const nextMaintenance = !!dataToSave.maintenanceMode;
        if (prevMaintenance !== nextMaintenance) {
          await addDoc(collection(db, 'logs'), {
            tenantId,
            type: 'maintenance_toggle',
            maintenance: nextMaintenance,
            actorId: currentUser?.id || null,
            actorName: currentUser?.name || 'Admin',
            message: maintenanceMessage,
            until: maintenanceUntilInput ? Date.parse(maintenanceUntilInput) : null,
            createdAt: serverTimestamp()
          });
        }
      } catch (logErr) {
        console.warn('Falha ao registrar log de manutenção:', logErr);
      }

      // Histórico de alterações
      try {
        const prev = settings || {};
        const keysToCheck = ['whatsappMessage','chargeMessageTemplate','betValue','devolution','maintenanceMode','maintenanceMessage','maintenanceUntil','maintenanceAllowedIps','maintenanceSchedule','whatsapp','betConfig','payment','abTests','rulesText','scoringCriteria','tiebreakRules','termsOfUse','systemPolicies','limitsRestrictions','complianceConfig'];
        const changedFields = [];
        keysToCheck.forEach(k => {
          const prevVal = prev ? prev[k] : undefined;
          if (JSON.stringify(prevVal) !== JSON.stringify(dataToSave[k])) changedFields.push(k);
        });
        if (changedFields.length > 0) {
          await addDoc(collection(db, 'settings_history'), {
            tenantId,
            changedFields,
            actorId: currentUser?.id || null,
            actorName: currentUser?.name || 'Admin',
            createdAt: serverTimestamp()
          });
        }
      } catch (histErr) {
        console.warn('Falha ao registrar histórico:', histErr);
      }

      alert('✅ Configurações atualizadas com sucesso!');
    } catch (error) {
      console.error('❌ Erro ao salvar:', error);
      alert('❌ Erro ao salvar: ' + (error?.message || 'erro'));
    }
  };

  const generateTop5PDF = async (roundId) => {
    try {
      setPdfLoadingRoundId('top5-' + roundId);
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 15;
      const contentWidth = pageWidth - margin * 2;

      const data = getRoundDashboardData(roundId);
      if (!data) { alert('⚠️ Rodada inválida ou não finalizada.'); return; }

      const { round, ranking, winners, prizePerWinner, prizePool, paidCount } = data;
      if (!ranking || ranking.length === 0) { alert('⚠️ Não há participantes pagos nesta rodada.'); return; }
      const top5 = ranking.slice(0, 5);

      // Paleta
      const primary = [22, 163, 74];
      const primaryDark = [16, 122, 56];
      const gray700 = [55, 65, 81];
      const lightBg = [248, 250, 252];
      const border = [229, 231, 235];
      const stripe = [245, 247, 250];

      // Helper: truncar com elipse respeitando largura
      const truncate = (txt, maxW, fontSize = 10, fontStyle = 'normal') => {
        if (!txt) return '-';
        pdf.setFontSize(fontSize);
        pdf.setFont(undefined, fontStyle);
        if (pdf.getTextWidth(txt) <= maxW) return txt;
        const ellipsis = '…';
        let low = 0, high = txt.length, best = ellipsis;
        while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          const candidate = txt.slice(0, mid) + ellipsis;
          if (pdf.getTextWidth(candidate) <= maxW) { best = candidate; low = mid + 1; } else { high = mid - 1; }
        }
        return best;
      };

      // Metadados
      try { pdf.setProperties && pdf.setProperties({ title: `Top 5 — ${round.name}`, subject: 'Ranking da Rodada', author: 'Bolão Brasileirão 2026' }); } catch (_) {}

      // Cabeçalho
      const drawHeader = () => {
        pdf.setFillColor(...primary);
        pdf.rect(0, 0, pageWidth, 26, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(14);
        pdf.setFont(undefined, 'bold');
        pdf.text('TOP 5 — BOLÃO BRASILEIRÃO 2026', margin, 11);
        pdf.setFontSize(11);
        pdf.setFont(undefined, 'normal');
        pdf.text(round.name, margin, 19);
        pdf.setFontSize(9);
        pdf.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, pageWidth - margin, 11, { align: 'right' });
        pdf.setTextColor(0, 0, 0);
        return 32;
      };

      // Cards resumo
      const drawSummary = (y) => {
        const gap = 6;
        const cardW = (contentWidth - gap) / 2;
        const cardH = 20;
        const cards = [
          { title: 'Cartelas pagas', value: String(paidCount) },
          { title: 'Premiação total (85%)', value: `R$ ${prizePool.toFixed(2)}` },
        ];
        let x = margin;
        cards.forEach((c) => {
          pdf.setFillColor(...lightBg);
          pdf.setDrawColor(...border);
          pdf.roundedRect(x, y, cardW, cardH, 3, 3, 'FD');
          pdf.setFontSize(8);
          pdf.setTextColor(...gray700);
          pdf.text(c.title, x + 8, y + 8);
          pdf.setFont(undefined, 'bold');
          pdf.setFontSize(12);
          pdf.setTextColor(0, 0, 0);
          pdf.text(c.value, x + 8, y + 15);
          pdf.setFont(undefined, 'normal');
          x += cardW + gap;
        });
        return y + cardH + 10;
      };

      let y = drawHeader();
      y = drawSummary(y);

      // Tabela Top 5
      const cols = [
        { key: 'pos', label: 'COLOCAÇÃO', w: 22, align: 'center' },
        { key: 'name', label: 'NOMES', w: contentWidth - 22 - 70 - 32, align: 'left' },
        { key: 'est', label: 'ESTABELECIMENTO', w: 70, align: 'left' },
        { key: 'pts', label: 'PONTUAÇÃO', w: 32, align: 'center' },
      ];

      const rowH = 10; // linhas mais altas
      const headerH = 12;
      const tableH = headerH + rowH * top5.length;
      pdf.setFillColor(...lightBg);
      pdf.setDrawColor(...border);
      pdf.roundedRect(margin, y, contentWidth, tableH + 8, 4, 4, 'FD');

      // Títulos
      let x = margin + 8;
      pdf.setFontSize(9);
      pdf.setFont(undefined, 'bold');
      cols.forEach((col) => {
        const headerX = x + (col.align === 'center' ? col.w / 2 : col.align === 'right' ? col.w : 0);
        pdf.text(col.label, headerX, y + 8, { align: col.align });
        x += col.w;
      });

      // Divisores verticais
      pdf.setDrawColor(...border);
      let sepX = margin + 8;
      cols.forEach((col, i) => {
        if (i > 0) {
          pdf.line(sepX, y + headerH, sepX, y + headerH + rowH * top5.length + 4);
        }
        sepX += col.w;
      });

      // Linhas
      pdf.setFont(undefined, 'normal');
      pdf.setFontSize(10);

      let rowTop = y + headerH + 4;
      top5.forEach((item, idx) => {
        // fundo listrado
        if (idx % 2 === 1) {
          pdf.setFillColor(...stripe);
          pdf.rect(margin + 3, rowTop - 7, contentWidth - 6, rowH, 'F');
        }

        // medal para top 3
        const medalColors = [
          [234, 179, 8],
          [148, 163, 184],
          [217, 119, 6],
        ];
        const startX = margin + 8;
        const posCellW = cols[0].w;
        if (idx < 3) {
          pdf.setFillColor(...medalColors[idx]);
          const centerX = startX + posCellW / 2;
          pdf.circle(centerX, rowTop - 2, 3, 'F');
        }

        const userName = item.user?.name || '-';
        const est = establishments.find((e) => e.id === item.establishmentId)?.name || '-';
        const pts = item.points;

        let cx = margin + 8;
        const cells = [
          { text: String(idx + 1), w: cols[0].w, align: 'center', style: 'bold' },
          { text: truncate(userName, cols[1].w - 2), w: cols[1].w, align: 'left' },
          { text: truncate(est, cols[2].w - 2), w: cols[2].w, align: 'left' },
          { text: String(pts), w: cols[3].w, align: 'center' },
        ];

        cells.forEach((cell) => {
          if (cell.style === 'bold') pdf.setFont(undefined, 'bold');
          else pdf.setFont(undefined, 'normal');
          const tx = cx + (cell.align === 'center' ? cell.w / 2 : cell.align === 'right' ? cell.w - 1 : 1);
          const ty = rowTop;
          pdf.text(cell.text, tx, ty, { align: cell.align });
          cx += cell.w;
        });

        // destaque campeão
        if (idx === 0) {
          pdf.setDrawColor(...primaryDark);
          pdf.setLineWidth(0.3);
          pdf.line(margin + 4, rowTop + 2, margin + contentWidth - 4, rowTop + 2);
        }

        rowTop += rowH;
      });

      // Rodapé
      pdf.setFontSize(8);
      pdf.setTextColor(...gray700);
      pdf.text('Relatório Top 5 — Bolão Brasileirão 2026', margin, pageHeight - 8);

      pdf.save(`Top5_${round.name.replace(/\s+/g, '_')}.pdf`);
    } catch (err) {
      console.error('Erro ao gerar Top 5 PDF:', err);
      alert('❌ Erro ao gerar PDF Top 5: ' + err.message);
    } finally {
      setPdfLoadingRoundId(null);
    }
  };



  const generateRoundPDF = async (roundId) => {
    try {
      setPdfLoadingRoundId(roundId);
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 15;
      const contentWidth = pageWidth - margin * 2;

      const round = rounds.find(r => r.id === roundId);
      if (!round) return;

      const allParticipants = getRoundParticipants(roundId);
      const paidParticipants = allParticipants.filter(p => p.paid);
      
      if (paidParticipants.length === 0) {
        alert('⚠️ Nenhum participante com pagamento confirmado nesta rodada!');
        return;
      }

      // Índices para acesso O(1)
      const usersById = new Map(users.map(u => [u.id, u]));
      const teamsById = new Map(teams.map(t => [t.id, t]));
      const predsByKey = new Map();
      predictions.forEach(p => {
        const key = `${p.userId}-${p.roundId}-${p.matchId}-${p.cartelaCode || 'ANTIGA'}`;
        if (!predsByKey.has(key)) predsByKey.set(key, p);
      });

      // Paleta e helpers de layout
      const primary = [22, 163, 74]; // verde
      const primaryDark = [16, 122, 56];
      const gray700 = [55, 65, 81];
      const lightBg = [248, 250, 252];
      const border = [229, 231, 235];

      // Metadados
      try { pdf.setProperties && pdf.setProperties({ title: `Bolão - ${round.name}`, subject: 'Cartelas confirmadas', author: 'Bolão Brasileirão 2026' }); } catch (_) {}

      const drawPageHeader = () => {
        pdf.setFillColor(...primary);
        pdf.rect(0, 0, pageWidth, 24, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(14);
        pdf.setFont(undefined, 'bold');
        pdf.text('BOLÃO BRASILEIRÃO 2026', margin, 10);
        pdf.setFontSize(11);
        pdf.text(round.name, margin, 18);
        pdf.setFontSize(9);
        pdf.setFont(undefined, 'normal');
        pdf.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, pageWidth - margin, 10, { align: 'right' });
        pdf.setTextColor(0, 0, 0);
        return 30; // y inicial do conteúdo
      };

      const drawSummaryCards = (y) => {
        const gap = 6;
        const cardW = (contentWidth - gap * 2) / 3;
        const cardH = 18;
        const cards = [
          { title: 'Cartelas pagas', value: paidParticipants.length },
          { title: 'Participantes únicos', value: [...new Set(paidParticipants.map(p => p.userId))].length },
          { title: 'Estabelecimentos', value: [...new Set(paidParticipants.map(p => p.establishmentId))].length || 0 },
        ];
        let x = margin;
        cards.forEach(c => {
          pdf.setFillColor(...lightBg);
          pdf.setDrawColor(...border);
          pdf.roundedRect(x, y, cardW, cardH, 2, 2, 'FD');
          pdf.setFontSize(8);
          pdf.setTextColor(...gray700);
          pdf.text(c.title, x + 6, y + 7);
          pdf.setFont(undefined, 'bold');
          pdf.setFontSize(12);
          pdf.setTextColor(0, 0, 0);
          pdf.text(String(c.value), x + 6, y + 14);
          pdf.setFont(undefined, 'normal');
          x += cardW + gap;
        });
        return y + cardH + 8;
      };

      let y = drawPageHeader();
      y = drawSummaryCards(y);

      // Agrupar cartelas por usuário
      const userCartelas = {};
      paidParticipants.forEach(participant => {
        const userId = participant.userId;
        if (!userCartelas[userId]) userCartelas[userId] = [];
        userCartelas[userId].push(participant);
      });

      const ensureSpace = (needed) => {
        if (y + needed > pageHeight - 18) {
          pdf.addPage();
          y = drawPageHeader();
        }
      };

      let participantIndex = 0;
      const matches = [...(round.matches || [])].sort(sortMatchesByDate);
      const rowH = 6;

      // Para cada usuário
      Object.entries(userCartelas).forEach(([userId, cartelas]) => {
        const user = usersById.get(userId);
        if (!user) return;
        
        cartelas.forEach((participant) => {
          participantIndex++;

          const rowsPerCol = Math.ceil((matches?.length || 0) / 2) || 0;
          // Limites da coluna esquerda (dados do participante)
          const leftTextX = margin + 8;
          const leftColRight = margin + contentWidth / 2 - 8;
          const leftTextMaxW = leftColRight - leftTextX;

          // Quebra de linha para evitar invasão da coluna direita
          const establishment = establishments.find(e => e.id === participant.establishmentId);
          const estText = establishment ? `Estabelecimento: ${establishment.name}` : '';
          const estLines = estText ? (pdf.splitTextToSize ? pdf.splitTextToSize(estText, leftTextMaxW) : [estText]) : [];

          // Altura dinâmica do cabeçalho para não sobrepor palpites
          const lineSpacing = 6;
          const headerH = 24 + lineSpacing * estLines.length;
          const innerPad = 10;
          const tableH = rowsPerCol * rowH;
          const cardH = headerH + tableH + innerPad;

          ensureSpace(cardH + 8);

          // Cartão do participante
          pdf.setFillColor(...lightBg);
          pdf.setDrawColor(...border);
          pdf.roundedRect(margin, y, contentWidth, cardH, 3, 3, 'FD');

          // Cabeçalho
          pdf.setFontSize(12);
          pdf.setFont(undefined, 'bold');
          pdf.text(`${participantIndex}. ${user.name}`, margin + 8, y + 8);

          // Bloco de informações (com largura limitada à metade esquerda)
          pdf.setFontSize(9);
          pdf.setFont(undefined, 'normal');
          pdf.setTextColor(...gray700);
          let infoY = y + 14;
          pdf.text(`Cartela: ${participant.cartelaCode}`, leftTextX, infoY);
          if (estLines.length) {
            estLines.forEach((line) => {
              infoY += lineSpacing;
              pdf.text(line, leftTextX, infoY);
            });
          }
          pdf.setTextColor(0, 0, 0);

          // Badge de status PAGO
          const badgeW = 24, badgeH = 8;
          const badgeX = margin + contentWidth - badgeW - 8;
          const badgeY = y + 6;
          pdf.setFillColor(...primary);
          pdf.roundedRect(badgeX, badgeY, badgeW, badgeH, 2, 2, 'F');
          pdf.setTextColor(255, 255, 255);
          pdf.setFontSize(9);
          pdf.setFont(undefined, 'bold');
          pdf.text('PAGO', badgeX + badgeW / 2, badgeY + badgeH / 2 + 0.5, { align: 'center' });
          pdf.setTextColor(0, 0, 0);
          pdf.setFont(undefined, 'normal');

          // Palpites em 2 colunas (começam abaixo do cabeçalho dinâmico)
          const startPredY = y + headerH;
          const col1X = margin + 10;
          const col2X = margin + contentWidth / 2 + 6;
          matches?.forEach((match, idx) => {
            const homeTeam = teamsById.get(match.homeTeamId);
            const awayTeam = teamsById.get(match.awayTeamId);
            const pred = predsByKey.get(`${user.id}-${roundId}-${match.id}-${participant.cartelaCode}`);
            if (!pred) return;

            const col = idx < rowsPerCol ? 1 : 2;
            const row = idx % rowsPerCol;
            const x = col === 1 ? col1X : col2X;
            const yLine = startPredY + row * rowH;
            pdf.setFontSize(9);
            const matchText = `${idx + 1}) ${homeTeam?.name} ${pred.homeScore} x ${pred.awayScore} ${awayTeam?.name}`;
            pdf.text(matchText, x, yLine);
          });

          y += cardH + 8;
        });
      });

      // Rodapé
      const pageCount = pdf.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        pdf.setPage(i);
        pdf.setFontSize(8);
        pdf.setFont(undefined, 'normal');
        pdf.setTextColor(120, 120, 120);
        pdf.text(`Página ${i} de ${pageCount}`, pageWidth / 2, pageHeight - 8, { align: 'center' });
      }

      // Salvar PDF
      const safeRound = (round.name || 'Rodada').replace(/[^\w]+/g, '_');
      pdf.save(`Bolao_${safeRound}_CONFIRMADOS_${new Date().getTime()}.pdf`);
      alert(`✅ PDF gerado com sucesso!\n\n📄 ${paidParticipants.length} cartelas confirmadas\n👥 ${Object.keys(userCartelas).length} participantes únicos`);
    } catch (error) {
      console.error('Erro ao gerar PDF:', error);
      alert('❌ Erro ao gerar PDF: ' + error.message);
    } finally {
      setPdfLoadingRoundId(null);
    }
  };

  // Gerar relatório financeiro por rodada e estabelecimento
  const generateFinancialReportPDF = async (roundId, establishmentId) => {
    try {
      if (!roundId) {
        alert('Selecione uma rodada para gerar o relatório.');
        return;
      }
      if (!establishmentId || establishmentId === 'all' || establishmentId === 'none') {
        alert('Selecione um estabelecimento específico para gerar o relatório.');
        return;
      }

      const pdf = new jsPDF('l', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 20;
      const contentWidth = pageWidth - margin * 2;

      const round = rounds.find(r => r.id === roundId);
      const establishment = establishments.find(e => e.id === establishmentId);
      const betValue = settings?.betValue || 15;

      // Participantes filtrados por estabelecimento
      const allParticipants = getRoundParticipants(roundId);
      const estParticipants = allParticipants.filter(p => p.establishmentId === establishmentId);
      const paidParticipants = estParticipants.filter(p => p.paid);
      const pendingParticipants = estParticipants.filter(p => !p.paid);

      const totalCount = estParticipants.length;
      const paidCount = paidParticipants.length;
      const pendingCount = pendingParticipants.length;
      const establishmentFee = paidParticipants.length * betValue * 0.05;

      // Paleta
      const primary = [22, 163, 74];
      const gray700 = [55, 65, 81];
      const lightBg = [248, 250, 252];
      const border = [229, 231, 235];
      const danger = [239, 68, 68];
      const success = [16, 185, 129];
      const orange = [251, 146, 60];
      const orangeLight = [255, 237, 213];

      const drawPageHeader = () => {
        pdf.setFillColor(...primary);
        pdf.rect(0, 0, pageWidth, 24, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(14);
        pdf.setFont(undefined, 'bold');
        pdf.text('Controle Financeiro', margin, 10);
        pdf.setFontSize(10);
        pdf.setFont(undefined, 'normal');
        const subtitle = `Rodada: ${round?.name || '-'}  •  Estabelecimento: ${establishment?.name || '-'}`;
        pdf.text(subtitle, margin, 18);
        pdf.setTextColor(0, 0, 0);
        return 32;
      };

      const drawCards = (y) => {
        const gap = 8;
        const cardW = (contentWidth - gap * 3) / 4;
        const cardH = 20;
        const cards = [
          { title: 'Participantes', value: String(totalCount), fill: lightBg, stroke: border, text: [0,0,0] },
          { title: 'Pagos', value: String(paidCount), fill: lightBg, stroke: border, text: [0,0,0] },
          { title: 'Pendentes', value: String(pendingCount), fill: lightBg, stroke: border, text: [0,0,0] },
          { title: 'Comissão (5%)', value: `R$ ${establishmentFee.toFixed(2)}`, fill: orangeLight, stroke: [252, 196, 120], text: [180, 83, 9] },
        ];
        let x = margin;
        cards.forEach(c => {
          pdf.setFillColor(...c.fill);
          pdf.setDrawColor(...c.stroke);
          pdf.roundedRect(x, y, cardW, cardH, 2, 2, 'FD');
          pdf.setFontSize(8);
          pdf.setTextColor(...gray700);
          pdf.text(c.title, x + 6, y + 7);
          pdf.setFont(undefined, 'bold');
          pdf.setFontSize(12);
          pdf.setTextColor(...c.text);
          pdf.text(c.value, x + 6, y + 15);
          pdf.setFont(undefined, 'normal');
          pdf.setTextColor(0,0,0);
          x += cardW + gap;
        });
        return y + cardH + 10;
      };

      const drawBars = (y) => {
        const boxH = 26;
        pdf.setFillColor(...lightBg);
        pdf.setDrawColor(...border);
        pdf.roundedRect(margin, y, contentWidth, boxH, 2, 2, 'FD');
        pdf.setFontSize(10);
        pdf.setFont(undefined, 'bold');
        pdf.setTextColor(...gray700);
        pdf.text('Resumo visual', margin + 6, y + 8);
        pdf.setTextColor(0,0,0);

        const startX = margin + 90;
        const innerW = contentWidth - (startX - margin) - 10;
        const scale = totalCount > 0 ? innerW / totalCount : 0;
        const barH = 6;
        const y1 = y + 12;
        const y2 = y + 12 + barH + 4;

        // Pago
        pdf.setFontSize(9);
        pdf.setTextColor(...gray700);
        pdf.text('Pagos', startX - 10, y1 + barH - 1);
        pdf.setFillColor(...success);
        pdf.rect(startX, y1, Math.max(2, paidCount * scale), barH, 'F');
        pdf.setTextColor(255,255,255);
        pdf.setFont(undefined, 'bold');
        pdf.text(String(paidCount), startX + Math.max(10, paidCount * scale) - 4, y1 + barH - 1, { align: 'right' });

        // Pendentes
        pdf.setFont(undefined, 'normal');
        pdf.setTextColor(...gray700);
        pdf.text('Pendentes', startX - 10, y2 + barH - 1);
        pdf.setFillColor(...danger);
        pdf.rect(startX, y2, Math.max(2, pendingCount * scale), barH, 'F');
        pdf.setTextColor(255,255,255);
        pdf.setFont(undefined, 'bold');
        pdf.text(String(pendingCount), startX + Math.max(10, pendingCount * scale) - 4, y2 + barH - 1, { align: 'right' });
        pdf.setTextColor(0,0,0);

        return y + boxH + 10;
      };

      const drawTable = (yStart) => {
        let y = yStart;
        const headerH = 10;
        const rowH = 9.5;
        const colParticipanteX = margin + 4;
        const colCartelaX = margin + Math.min(140, contentWidth * 0.54);
        const colValorX = margin + contentWidth - 45;
        const colStatusX = margin + contentWidth - 15;
        const colValorW = 30;
        const colStatusW = 22;
        const colValorCenterX = colValorX + colValorW / 2;
        const colStatusCenterX = colStatusX + colStatusW / 2;

        const drawHeader = () => {
          pdf.setFillColor(...primary);
          pdf.rect(margin, y, contentWidth, headerH, 'F');
          pdf.setFontSize(10);
          pdf.setFont(undefined, 'bold');
          pdf.setTextColor(255,255,255);
          pdf.text('Participante', colParticipanteX, y + headerH / 2, { baseline: 'middle' });
          pdf.text('Cartela', colCartelaX, y + headerH / 2, { baseline: 'middle' });
          pdf.text('Valor', colValorCenterX, y + headerH / 2, { baseline: 'middle', align: 'center' });
          pdf.text('Status', colStatusCenterX, y + headerH / 2, { baseline: 'middle', align: 'center' });
          pdf.setTextColor(0,0,0);
          y += headerH;
        };

        const ensurePage = () => {
          if (y > pageHeight - 25) {
            pdf.addPage();
            y = drawPageHeader();
            drawHeader();
          }
        };

        drawHeader();

        estParticipants.forEach((p, idx) => {
          ensurePage();

          // Zebra row background
          if (idx % 2 === 0) {
            pdf.setFillColor(250,250,250);
            pdf.rect(margin, y, contentWidth, rowH, 'F');
          }

          const user = users.find(u => u.id === p.userId);
          const nome = user?.name || `Participante ${idx + 1}`;
          const cartelaRaw = p.cartelaCode || 'ANTIGA';
          const cartela = cartelaRaw.length > 24 ? `${cartelaRaw.slice(0, 24)}…` : cartelaRaw;

          // Text columns
          pdf.setFontSize(9.5);
          pdf.setFont(undefined, 'normal');
          const textY = y + rowH / 2 + 0.5;
          pdf.text(nome, colParticipanteX, textY, { baseline: 'middle' });
          pdf.text(cartela, colCartelaX, textY, { baseline: 'middle' });
          pdf.text(`R$ ${betValue.toFixed(2)}`, colValorCenterX, textY, { baseline: 'middle', align: 'center' });

          // Status pill
          const status = p.paid ? 'Pago' : 'Não pago';
          const pillFill = p.paid ? success : danger;
          const pillText = [255,255,255];
          const pillPad = 3;
          const pillW = pdf.getTextWidth(status) + pillPad * 2;
          const pillH = 6.5;
          const pillX = colStatusCenterX - pillW / 2;
          const pillY = y + (rowH - pillH) / 2;
          pdf.setFillColor(...pillFill);
          pdf.roundedRect(pillX, pillY, pillW, pillH, 3, 3, 'F');
          pdf.setTextColor(...pillText);
          pdf.setFontSize(9);
          pdf.setFont(undefined, 'bold');
          pdf.text(status, colStatusCenterX, textY - 0.5, { align: 'center', baseline: 'middle' });
          pdf.setTextColor(0,0,0);
          pdf.setFont(undefined, 'normal');

          y += rowH;
        });

        return y;
      };

      let y = drawPageHeader();
      y = drawCards(y);
      y = drawBars(y);
      y = drawTable(y);

      // Devedores
      if (pendingParticipants.length > 0) {
        if (y > pageHeight - 40) {
          pdf.addPage();
          y = drawPageHeader();
        }
        pdf.setFontSize(12);
        pdf.setFont(undefined, 'bold');
        pdf.setTextColor(...danger);
        pdf.text('Devedores (não pagos)', margin, y + 10);
        pdf.setTextColor(0,0,0);
        y += 16;
        pdf.setFontSize(9.5);
        pendingParticipants.forEach((p, i) => {
          const user = users.find(u => u.id === p.userId);
          pdf.text(`• ${user?.name || 'Participante'}  —  Cartela: ${p.cartelaCode || 'ANTIGA'}`, margin, y);
          y += 6.5;
        });
      }

      const fileName = `Financeiro_${round?.name || 'Rodada'}_${establishment?.name || 'Estabelecimento'}.pdf`;
      pdf.save(fileName);
    } catch (error) {
      console.error('Erro ao gerar PDF financeiro:', error);
      alert('❌ Erro ao gerar PDF.');
    }
  };

  // Relatório oficial da rodada finalizada: cards por participante com Jogo | Palpite | Placar Final | Pts
  const generateFinalizedRoundReportPDF = async (roundId) => {
    try {
      if (!roundId) { alert('Selecione uma rodada finalizada.'); return; }
      setPdfLoadingRoundId('final-' + roundId);

      const round = rounds.find(r => r.id === roundId);
      if (!round || round.status !== 'finished') {
        alert('Rodada inválida ou ainda não finalizada.');
        return;
      }

      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 15;
      const contentWidth = pageWidth - margin * 2;

      const participants = getRoundParticipants(roundId).filter(p => p.paid);
      if (participants.length === 0) { alert('Não há participantes pagos nesta rodada.'); return; }

      const usersById = new Map(users.map(u => [u.id, u]));
      const teamsById = new Map(teams.map(t => [t.id, t]));
      const matches = [...(round.matches || [])].sort(sortMatchesByDate);

      // Paleta
      const primary = [22, 163, 74];
      const gray700 = [55, 65, 81];
      const lightBg = [248, 250, 252];
      const border = [229, 231, 235];

      // Helpers
      const formatDate = (ts) => {
        try {
          const d = round?.closeAt ? new Date(round.closeAt) : (round?.createdAt?.toDate ? round.createdAt.toDate() : new Date());
          const yyyy = d.getFullYear();
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          return `${dd}/${mm}/${yyyy}`;
        } catch { return new Date().toLocaleDateString('pt-BR'); }
      };

      const extractRoundNumber = () => {
        const m = (round.name || '').match(/(\d+)/);
        return m ? m[1] : '';
      };

      const resultLabel = (home, away) => {
        if (home > away) return 'Mandante';
        if (home < away) return 'Visitante';
        return 'Empate';
      };

      const scorePoints = (ph, pa, rh, ra) => {
        if (ph === rh && pa === ra) return 3;
        return resultLabel(ph, pa) === resultLabel(rh, ra) ? 1 : 0;
      };

      // Metadados
      try {
        pdf.setProperties({
          title: `Relatório Rodada ${round.name}`,
          subject: 'Comprovante oficial da rodada',
          author: 'Bolão Brasileirão 2026',
          keywords: 'bolão, brasileirão, relatório, rodada, pdf',
          creator: 'Bolão App'
        });
      } catch {}

      const drawHeader = () => {
        pdf.setFillColor(...primary);
        pdf.rect(0, 0, pageWidth, 26, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.setFont(undefined, 'bold');
        pdf.setFontSize(14);
        pdf.text('BOLÃO BRASILEIRÃO 2026', margin, 11);
        pdf.setFont(undefined, 'normal');
        pdf.setFontSize(11);
        pdf.text(`Relatório da ${round.name}`, margin, 19);
        pdf.setFontSize(9);
        pdf.text(`Data da rodada: ${formatDate(round?.closeAt)}`, pageWidth - margin, 11, { align: 'right' });
        pdf.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, pageWidth - margin, 19, { align: 'right' });
        pdf.setTextColor(0,0,0);
        return 32;
      };

      const drawFooterPagination = () => {
        const pageCount = pdf.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
          pdf.setPage(i);
          pdf.setFontSize(8);
          pdf.setTextColor(120, 120, 120);
          pdf.setFont(undefined, 'normal');
          pdf.text(`Relatório oficial da rodada • v1.0`, margin, pageHeight - 8);
          pdf.text(`Página ${i} de ${pageCount}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
        }
      };

      let y = drawHeader();

      // Lista completa – cartões por participante
      const rowH = 7; // altura por linha de jogo
      const headerH = 22; // cabeçalho do cartão
      const tablePad = 8; // padding interno

      // Tabela com 4 colunas: Jogo | Palpite | Placar Final | Pts
      const cols = [
        { key: 'jogo', label: 'Jogo', w: contentWidth * 0.40, align: 'left' },
        { key: 'palpite', label: 'Palpite', w: contentWidth * 0.22, align: 'center' },
        { key: 'placar', label: 'Placar Final', w: contentWidth * 0.26, align: 'center' },
        { key: 'pts', label: 'Pts', w: contentWidth * 0.12, align: 'center' },
      ];

      let idx = 0;
      
      const participantsWithPoints = participants.map(p => {
        let totalPts = 0;
        matches.forEach(m => {
          const pred = predictions.find(x => x.userId === p.userId && x.roundId === roundId && x.matchId === m.id && (x.cartelaCode || 'ANTIGA') === p.cartelaCode);
          if (pred && m.finished && m.homeScore != null && m.awayScore != null) {
            const ph = pred.homeScore ?? '-';
            const pa = pred.awayScore ?? '-';
            totalPts += scorePoints(ph, pa, m.homeScore, m.awayScore);
          }
        });
        return { ...p, totalPts };
      });

      participantsWithPoints.sort((a, b) => b.totalPts - a.totalPts);

      participantsWithPoints.forEach((p) => {
        const user = usersById.get(p.userId);
        if (!user) return;

        const tableH = rowH * matches.length + tablePad * 2 + 12 + 8; // +8 espaço pro total
        const cardH = headerH + tableH;
        if (y + cardH > pageHeight - 16) { pdf.addPage(); y = drawHeader(); }

        // Cartão
        pdf.setFillColor(...lightBg);
        pdf.setDrawColor(...border);
        pdf.roundedRect(margin, y, contentWidth, cardH, 3, 3, 'FD');

        // Cabeçalho do cartão
        pdf.setFontSize(12);
        pdf.setFont(undefined, 'bold');
        pdf.text(`${++idx}. ${user.name}`, margin + 8, y + 10);
        pdf.setFontSize(9);
        pdf.setFont(undefined, 'normal');
        pdf.setTextColor(...gray700);
        const est = establishments.find(e => e.id === p.establishmentId)?.name || 'Nenhum';
        pdf.text(`Cartela: ${p.cartelaCode}  •  Estabelecimento: ${est}`, margin + 8, y + 16);
        pdf.setTextColor(0,0,0);

        // Tabela – cabeçalho
        let tx = margin + 8;
        let ty = y + headerH + 10;
        pdf.setFont(undefined, 'bold');
        pdf.setFontSize(9);
        cols.forEach((c) => {
          const hx = tx + (c.align === 'center' ? c.w/2 : c.align === 'right' ? c.w - 1 : 1);
          pdf.text(c.label, hx, ty, { align: c.align });
          tx += c.w;
        });

        // Linhas da tabela
        pdf.setFont(undefined, 'normal');
        pdf.setFontSize(9);
        let rowY = ty + 6;
        matches.forEach((m, i) => {
          const home = teamsById.get(m.homeTeamId);
          const away = teamsById.get(m.awayTeamId);
          const pred = predictions.find(x => x.userId === p.userId && x.roundId === roundId && x.matchId === m.id && (x.cartelaCode || 'ANTIGA') === p.cartelaCode);
          const homeScore = m.homeScore ?? 0;
          const awayScore = m.awayScore ?? 0;
          const ph = pred?.homeScore ?? '-';
          const pa = pred?.awayScore ?? '-';
          const pts = pred && m.finished && m.homeScore != null && m.awayScore != null ? scorePoints(ph, pa, homeScore, awayScore) : 0;

          let cx = margin + 8;
          const cells = [
            { text: `${i+1}) ${home?.name} x ${away?.name}`, w: cols[0].w, align: 'left' },
            { text: `${ph} x ${pa}`, w: cols[1].w, align: 'center' },
            { text: `${homeScore} x ${awayScore}`, w: cols[2].w, align: 'center' },
            { text: String(pts), w: cols[3].w, align: 'center' },
          ];
          cells.forEach((cell) => {
            const tx2 = cx + (cell.align === 'center' ? cell.w/2 : cell.align === 'right' ? cell.w - 1 : 1);
            pdf.text(cell.text, tx2, rowY, { align: cell.align });
            cx += cell.w;
          });
          rowY += rowH;
        });

        // Linha de Total
        pdf.setFont(undefined, 'bold');
        pdf.text('TOTAL:', margin + 8 + cols[0].w + cols[1].w + cols[2].w - 2, rowY + 2, { align: 'right' });
        pdf.setTextColor(...primary);
        pdf.text(String(p.totalPts), margin + 8 + cols[0].w + cols[1].w + cols[2].w + (cols[3].w/2), rowY + 2, { align: 'center' });
        pdf.setTextColor(0,0,0);

        y += cardH + 8;
      });

      // Rodapé com paginação e metadados
      drawFooterPagination();

      // Nome do arquivo padrão: Relatorio_Rodada_[Número]_[Data].pdf
      const num = extractRoundNumber();
      const dateSafe = formatDate(round?.closeAt).replace(/\//g, '-');
      const fileName = `Relatorio_Rodada_${num || round.name.replace(/\s+/g,'_')}_${dateSafe}.pdf`;
      pdf.save(fileName);

    } catch (err) {
      console.error('Erro ao gerar PDF finalizado:', err);
      alert('Erro ao gerar PDF: ' + (err?.message || 'erro'));
    } finally {
      setPdfLoadingRoundId(null);
    }
  };

  const handleResetTeams = async () => {
    if (!confirm('⚠️ ATENÇÃO!\n\nIsso irá DELETAR todos os times cadastrados e recarregar apenas os 20 times oficiais da Série A 2026.\n\n⚠️ CUIDADO: Se houver rodadas criadas com times antigos, elas podem ficar quebradas!\n\nDeseja continuar?')) {
      return;
    }
    try {
      await resetTeamsToSerieA2026();
      alert('✅ Times resetados com sucesso!\n\n20 times oficiais da Série A 2026 foram carregados.');
    } catch (error) {
      alert('❌ Erro ao resetar times: ' + error.message);
    }
  };

  // Corrige times duplicados por nome e relinca rodadas para o ID canônico
  const handleFixTeamsDuplicates = async () => {
    try {
      // Buscar todos os times
      const teamsSnap = await getDocs(collection(db, 'teams'));
      const allTeams = teamsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // Agrupar por nome normalizado
      const normalizeName = (s) => s?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      const groups = {};
      allTeams.forEach(t => {
        const key = normalizeName(t.name || '');
        if (!groups[key]) groups[key] = [];
        groups[key].push(t);
      });

      // Identificar apenas os grupos com duplicatas (length > 1)
      // Times que aparecem só 1 vez NÃO são tocados
      const duplicateGroups = Object.entries(groups).filter(([, group]) => group.length > 1);

      if (duplicateGroups.length === 0) {
        alert('✅ Nenhuma duplicação encontrada. Todos os times são únicos.');
        return;
      }

      // Buscar rodadas para saber quais times estão vinculados
      const roundsSnap = await getDocs(query(collection(db, 'rounds'), where('tenantId', '==', tenantId)));
      const linkedTeamIds = new Set();
      for (const rd of roundsSnap.docs) {
        const matches = Array.isArray(rd.data().matches) ? rd.data().matches : [];
        matches.forEach(m => {
          if (m.homeTeamId) linkedTeamIds.add(m.homeTeamId);
          if (m.awayTeamId) linkedTeamIds.add(m.awayTeamId);
        });
      }

      // Para cada grupo duplicado, escolher o canônico (prioriza o que está vinculado a rodadas)
      const idMap = {}; // id duplicado => id canônico
      const toDelete = [];
      let preview = '';

      duplicateGroups.forEach(([, group]) => {
        // Priorizar: 1) vinculado a rodadas, 2) primeiro criado
        const sorted = [...group].sort((a, b) => {
          const aLinked = linkedTeamIds.has(a.id) ? 1 : 0;
          const bLinked = linkedTeamIds.has(b.id) ? 1 : 0;
          if (bLinked !== aLinked) return bLinked - aLinked;
          return 0; // manter ordem original
        });
        const canonical = sorted[0];
        const duplicates = sorted.slice(1);
        preview += `• "${canonical.name}" — mantém 1, remove ${duplicates.length} duplicata(s)\n`;
        duplicates.forEach(dup => {
          idMap[dup.id] = canonical.id;
          toDelete.push(dup.id);
        });
      });

      const uniqueCount = Object.values(groups).filter(g => g.length === 1).length;
      const confirmMsg = `🔧 Correção de Duplicados\n\n` +
        `Times únicos (não serão alterados): ${uniqueCount}\n` +
        `Times duplicados encontrados: ${toDelete.length}\n` +
        `Grupos com duplicatas: ${duplicateGroups.length}\n\n` +
        `Detalhes:\n${preview}\n` +
        `Após a correção, restará ${allTeams.length - toDelete.length} times.\n\n` +
        `Deseja continuar?`;

      if (!confirm(confirmMsg)) return;

      // Atualizar rodadas substituindo IDs duplicados pelo canônico
      let roundsChanged = 0;
      for (const rd of roundsSnap.docs) {
        const data = rd.data();
        const matches = Array.isArray(data.matches) ? data.matches : [];
        let changed = false;
        const updatedMatches = matches.map(m => {
          const home = idMap[m.homeTeamId] || m.homeTeamId;
          const away = idMap[m.awayTeamId] || m.awayTeamId;
          if (home !== m.homeTeamId || away !== m.awayTeamId) changed = true;
          return { ...m, homeTeamId: home, awayTeamId: away };
        });
        if (changed) {
          await updateDoc(doc(db, 'rounds', rd.id), { matches: updatedMatches });
          roundsChanged++;
        }
      }

      // Atualizar predictions que referenciam times duplicados (matchId pode conter teamId)
      // Não é necessário pois predictions referenciam matchId, não teamId diretamente

      // Remover apenas os times duplicados
      for (const id of toDelete) {
        await deleteDoc(doc(db, 'teams', id));
      }

      alert(`✅ Correção concluída!\n\nDuplicatas removidas: ${toDelete.length}\nRodadas atualizadas: ${roundsChanged}\nTimes restantes: ${allTeams.length - toDelete.length}\nTimes únicos preservados: ${uniqueCount}`);
    } catch (error) {
      console.error('Erro ao corrigir duplicados:', error);
      alert('❌ Erro ao corrigir duplicados: ' + error.message);
    }
  };

  const handleFixUserDuplicates = async () => {
    try {
      const usersSnap = await getDocs(collection(db, 'users'));
      const allUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const normalizeWhatsapp = (s) => {
        const d = (s || '').replace(/\D/g, '');
        return d.length > 11 ? d.slice(-11) : d;
      };

      const groups = {};
      allUsers.forEach(u => {
        if (u.isAdmin) return; // Não mexe nos admins
        const key = normalizeWhatsapp(u.whatsapp);
        if (!key) return; // Ignora se não tiver número válido
        if (!groups[key]) groups[key] = [];
        groups[key].push(u);
      });

      const duplicateGroups = Object.entries(groups).filter(([, group]) => group.length > 1);

      if (duplicateGroups.length === 0) {
        alert('✅ Nenhuma duplicação de usuário encontrada.');
        return;
      }

      // Conta palpites por usuário para priorizar
      const predsSnap = await getDocs(query(collection(db, 'predictions'), where('tenantId', '==', tenantId)));
      const userPredCount = {};
      predsSnap.docs.forEach(p => {
        const uid = p.data().userId;
        if (uid) userPredCount[uid] = (userPredCount[uid] || 0) + 1;
      });

      const idMap = {}; // id duplicado => id canônico
      const toDelete = [];
      let preview = '';

      duplicateGroups.forEach(([phone, group]) => {
        // Prioriza: 1) Mais palpites, 2) Maior saldo, 3) Mais antigo
        const sorted = [...group].sort((a, b) => {
          const predsA = userPredCount[a.id] || 0;
          const predsB = userPredCount[b.id] || 0;
          if (predsB !== predsA) return predsB - predsA;
          
          const balA = a.balance || 0;
          const balB = b.balance || 0;
          if (balB !== balA) return balB - balA;
          
          const tA = a.createdAt?.toDate?.()?.getTime() || 0;
          const tB = b.createdAt?.toDate?.()?.getTime() || 0;
          return tA - tB;
        });

        const canonical = sorted[0];
        const duplicates = sorted.slice(1);
        preview += `• ${canonical.name} (${phone}) — mantém 1, remove ${duplicates.length}\n`;
        
        duplicates.forEach(dup => {
          idMap[dup.id] = canonical.id;
          toDelete.push(dup.id);
        });
      });

      const uniqueCount = Object.values(groups).filter(g => g.length === 1).length;
      const confirmMsg = `👥 Correção de Usuários Duplicados\n\n` +
        `Usuários únicos (não serão alterados): ${uniqueCount}\n` +
        `Usuários duplicados encontrados: ${toDelete.length}\n` +
        `Grupos com duplicatas: ${duplicateGroups.length}\n\n` +
        `Detalhes:\n${preview}\n` +
        `Os palpites serão transferidos para o perfil principal antes da exclusão.\n\n` +
        `Deseja continuar?`;

      if (!confirm(confirmMsg)) return;

      // Transferir palpites
      let predsChanged = 0;
      for (const p of predsSnap.docs) {
        const data = p.data();
        if (idMap[data.userId]) {
          await updateDoc(doc(db, 'predictions', p.id), { userId: idMap[data.userId] });
          predsChanged++;
        }
      }

      // Remover duplicados
      for (const id of toDelete) {
        await deleteDoc(doc(db, 'users', id));
      }

      alert(`✅ Correção concluída!\n\nDuplicatas removidas: ${toDelete.length}\nPalpites transferidos: ${predsChanged}\nUsuários restantes: ${allUsers.length - toDelete.length}`);
    } catch (error) {
      console.error('Erro ao corrigir usuários duplicados:', error);
      alert('❌ Erro: ' + error.message);
    }
  };

  const saveRound = async (roundData) => {
    try {
      if (editingRound) {
        await updateRound(editingRound.id, roundData);
      } else {
        await addRound(roundData);
      }
      setEditingRound(null);
      setShowRoundForm(false);
    } catch (error) {
      alert('Erro: ' + error.message);
    }
  };

  const saveTeam = async (teamData) => {
    try {
      if (editingTeam) {
        await updateTeam(editingTeam.id, teamData);
      } else {
        await addTeam(teamData);
      }
      setEditingTeam(null);
      setShowTeamForm(false);
    } catch (error) {
      alert('Erro: ' + error.message);
    }
  };

  const saveEstablishment = async (estData) => {
    try {
      if (editingEstablishment) {
        await updateEstablishment(editingEstablishment.id, estData);
      } else {
        await addEstablishment(estData);
      }
      setEditingEstablishment(null);
      setShowEstablishmentForm(false);
    } catch (error) {
      alert('Erro: ' + error.message);
    }
  };

  const savePassword = async (newPassword) => {
    try {
      if (currentUser?.id === editingPassword.id) {
        // Troca da própria senha: direto no Firebase Auth.
        await updateUser(editingPassword.id, { password: newPassword });
      } else {
        // Admin redefine senha de outro usuário: via endpoint com Admin SDK.
        const idToken = await getIdToken();
        const resp = await fetch('/api/admin/update-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken, targetUserId: editingPassword.id, newPassword })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Falha ao redefinir senha');
      }
      alert('✅ Senha alterada com sucesso!');
      setEditingPassword(null);
    } catch (error) {
      alert('❌ Erro ao alterar senha: ' + error.message);
    }
  };

  const saveUser = async (fields) => {
    try {
      const idToken = await getIdToken();
      const resp = await fetch('/api/admin/update-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, targetUserId: editingUser.id, ...fields })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Falha ao salvar');
      alert('✅ Dados atualizados com sucesso!');
      setEditingUser(null);
    } catch (error) {
      alert('❌ Erro ao atualizar: ' + error.message);
    }
  };

  const changeStatus = async (id, newStatus) => {
    const round = rounds.find(r => r.id === id);
    if (round) {
      // Finalizar é o ato que publica o ranking e define o prêmio. Com jogo
      // manual sem placar, o ranking sairia errado e já divulgado — e desfazer
      // resultado anunciado no grupo é o pior tipo de correção.
      if (newStatus === 'finished') {
        const pendentes = jogosManuaisPendentes(round.matches || []);
        if (pendentes.length) {
          const lista = pendentes
            .map(m => {
              const casa = teams.find(t => t.id === m.homeTeamId)?.name || m.homeTeamName || 'Time';
              const fora = teams.find(t => t.id === m.awayTeamId)?.name || m.awayTeamName || 'Time';
              return `• ${casa} x ${fora}`;
            })
            .join('\n');
          alert(
            `Faltam os placares dos jogos manuais desta rodada:\n\n${lista}\n\n` +
            'Abra "Editar" na rodada, lance os resultados e finalize de novo.'
          );
          return;
        }
      }
      // Ao retornar para 'closed', resetar flags de finalização para o cron reprocessar
      const extraFields = newStatus === 'closed'
        ? { resultadoCalculado: false, resultSentToGroup: false }
        : {};
      await updateRound(id, { ...round, status: newStatus, ...extraFields });

      if (newStatus === 'finished') {
        setTimeout(() => { generateRoundPDF(id); }, 500);
        setTimeout(() => { generateFinalizedRoundReportPDF(id); }, 1200);
        setTimeout(async () => {
          try {
            const msg = buildResultGroupMessage(id);
            if (msg) await sendTextToGroup(msg);
          } catch (err) {
            console.warn('Aviso: não foi possível enviar resultado ao grupo:', err.message);
          }
        }, 2000);
      }
    }
  };

  const getStatusBadge = (status) => {
    const badges = {
      upcoming: { text: 'Futura', color: 'bg-gray-100 text-gray-700', icon: '🔜' },
      open: { text: 'Aberta', color: 'bg-green-100 text-green-700', icon: '✅' },
      closed: { text: 'Fechada', color: 'bg-yellow-100 text-yellow-700', icon: '🔒' },
      finished: { text: 'Finalizada', color: 'bg-blue-100 text-blue-700', icon: '🏁' }
    };
    return badges[status] || badges.upcoming;
  };

  const isRoundTimedClosed = (round) => {
    if (!round?.closeAt) return false;
    const ts = new Date(round.closeAt).getTime();
    return !isNaN(ts) && Date.now() >= ts;
  };

  const formatDateTime = (value) => {
    if (!value) return null;
    const dt = new Date(value);
    if (isNaN(dt.getTime())) return null;
    return dt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
  };

  const sortByNumber = (a, b) => (a.number || 0) - (b.number || 0);
  const openRounds = rounds.filter(r => r.status === 'open' && !isRoundTimedClosed(r)).sort(sortByNumber);
  // Rodadas disponíveis para palpites: abertas ou futuras, desde que não fechadas pelo cronograma
  const predictableRounds = rounds.filter(r => (r.status === 'open' || r.status === 'upcoming') && !isRoundTimedClosed(r)).sort(sortByNumber);
  const closedRounds = rounds.filter(r => r.status === 'closed' || (r.status === 'open' && isRoundTimedClosed(r))).sort(sortByNumber);
  const finishedRounds = rounds.filter(r => r.status === 'finished').sort(sortByNumber);
  const upcomingRounds = rounds.filter(r => r.status === 'upcoming').sort(sortByNumber);

  const fmtRoundDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    } catch { return '—'; }
  };

  const getRoundDateRange = (round) => {
    if (!round.matches?.length) return null;
    const dates = round.matches.map(m => m.date).filter(Boolean).sort();
    const first = fmtRoundDate(dates[0]);
    const last = fmtRoundDate(dates[dates.length - 1]);
    return first === last ? first : `${first} – ${last}`;
  };

  // Card completo — para rodadas abertas e fechadas
  const renderRoundCard = (round) => {
    const effectiveStatus = (round.status === 'open' && isRoundTimedClosed(round)) ? 'closed' : round.status;
    const badge = getStatusBadge(effectiveStatus);
    const isExpanded = expandedAdminRounds[round.id];
    const dateRange = getRoundDateRange(round);

    return (
      <div key={round.id} className="bg-white rounded-xl shadow-sm border overflow-hidden">
        {/* Header do card */}
        <div className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            {/* Info principal */}
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-green-50 border border-green-200 flex items-center justify-center">
                <span className="text-sm font-bold text-green-700">{round.number || '—'}</span>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-bold text-gray-900 truncate">{round.name}</h3>
                  <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${badge.color}`}>{badge.icon} {badge.text}</span>
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                  <span>{(() => { const r = resumoDaRodada(round.matches || []); return r.adiados ? `${r.valendo} jogos (${r.adiados} adiado${r.adiados > 1 ? 's' : ''})` : `${r.total} jogos`; })()}</span>
                  {dateRange && <span>📅 {dateRange}</span>}
                  {round.closeAt && <span>🔒 fecha {new Date(round.closeAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}</span>}
                </div>
              </div>
            </div>

            {/* Ações */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {round.status === 'upcoming' && <button onClick={() => changeStatus(round.id, 'open')} className="px-2.5 py-1.5 bg-green-100 text-green-700 rounded-lg text-xs font-medium">Abrir</button>}
              {round.status === 'open' && <button onClick={() => changeStatus(round.id, 'closed')} className="px-2.5 py-1.5 bg-yellow-100 text-yellow-700 rounded-lg text-xs font-medium">Fechar</button>}
              {round.status === 'closed' && <button onClick={() => changeStatus(round.id, 'finished')} className="px-2.5 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-xs font-medium">Finalizar</button>}
              {(round.status === 'closed' || round.status === 'finished') && (
                <button onClick={() => generateRoundPDF(round.id)} disabled={pdfLoadingRoundId === round.id} className="p-1.5 bg-purple-100 text-purple-700 rounded-lg disabled:opacity-40" title="Gerar PDF">
                  {pdfLoadingRoundId === round.id ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                </button>
              )}
              {round.status === 'finished' && (
                <button onClick={() => generateFinalizedRoundReportPDF(round.id)} disabled={pdfLoadingRoundId === ('final-' + round.id)} className="p-1.5 bg-purple-100 text-purple-700 rounded-lg disabled:opacity-40" title="Relatório oficial">
                  {pdfLoadingRoundId === ('final-' + round.id) ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
                </button>
              )}
              <button onClick={() => { setEditingRound(round); setShowRoundForm(true); }} className="p-1.5 bg-blue-100 text-blue-700 rounded-lg" title="Editar"><Edit2 size={15} /></button>
              <button onClick={() => confirm('Excluir esta rodada?') && deleteRound(round.id)} className="p-1.5 bg-red-100 text-red-700 rounded-lg" title="Excluir"><Trash2 size={15} /></button>
              <button onClick={() => toggleAdminRound(round.id)} className="p-1.5 bg-gray-100 text-gray-600 rounded-lg" title={isExpanded ? 'Recolher' : 'Ver jogos'}>
                {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </button>
            </div>
          </div>

          {/* Jogos expandidos */}
          {isExpanded && (
            <div className="mt-4 pt-4 border-t space-y-1.5">
              {(() => {
                const r = resumoDaRodada(round.matches || []);
                if (!r.adiados) return null;
                return (
                  <div className="bg-orange-50 border border-orange-200 text-orange-800 rounded-lg px-3 py-2 text-sm mb-2">
                    <strong>{r.adiados} jogo(s) adiado(s).</strong> Esta rodada vale {r.valendo} de {r.total} jogos —
                    os adiados saíram do palpite e não pontuam para ninguém.
                  </div>
                );
              })()}
              {[...(round.matches || [])].sort(sortMatchesByDate).map((match) => {
                const homeTeam = teams.find(t => t.id === match.homeTeamId);
                const awayTeam = teams.find(t => t.id === match.awayTeamId);
                const homeName = homeTeam?.name || match.homeTeamName || '?';
                const awayName = awayTeam?.name || match.awayTeamName || '?';
                const adiado = isMatchPostponed(match);
                return (
                  <div key={match.id} className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${adiado ? 'bg-orange-50 border border-orange-200' : 'bg-gray-50'}`}>
                    <div className={`flex items-center gap-2 min-w-0 ${adiado ? 'opacity-60' : ''}`}>
                      <img src={getSafeLogo(homeTeam || { logo: match.homeTeamLogo })} alt={homeName} className="w-6 h-6 object-contain rounded bg-white ring-1 ring-gray-200 flex-shrink-0" width={24} height={24} />
                      <span className="font-medium truncate max-w-[80px] sm:max-w-none">{homeName}</span>
                      {isMatchEffectivelyFinished(match) && match.homeScore !== null ? (
                        <span className="flex-shrink-0 mx-1 font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded text-xs">{match.homeScore} × {match.awayScore}</span>
                      ) : (
                        <span className="flex-shrink-0 mx-1 text-gray-400 text-xs font-medium">vs</span>
                      )}
                      <img src={getSafeLogo(awayTeam || { logo: match.awayTeamLogo })} alt={awayName} className="w-6 h-6 object-contain rounded bg-white ring-1 ring-gray-200 flex-shrink-0" width={24} height={24} />
                      <span className="font-medium truncate max-w-[80px] sm:max-w-none">{awayName}</span>
                    </div>
                    {adiado && (
                      <span className="flex-shrink-0 ml-2 text-[10px] font-bold uppercase px-2 py-1 rounded-full bg-orange-100 text-orange-700" style={{ letterSpacing: '0.08em' }}>
                        Adiado · não vale pontos
                      </span>
                    )}
                    {!adiado && match.date && (
                      <span className="text-xs text-gray-400 flex-shrink-0 ml-2">
                        {new Date(match.date).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Linha compacta — para rodadas futuras (upcoming)
  const renderRoundRow = (round) => {
    const dateRange = getRoundDateRange(round);
    return (
      <div key={round.id} className="flex items-center justify-between py-2.5 px-3 hover:bg-gray-50 rounded-lg transition-colors group">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-8 text-center text-sm font-bold text-gray-400">{round.number}</span>
          <div className="min-w-0">
            <span className="text-sm font-medium text-gray-800">{round.name}</span>
            {dateRange && <span className="ml-2 text-xs text-gray-400">{dateRange}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => changeStatus(round.id, 'open')} className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">Abrir</button>
          <button onClick={() => { setEditingRound(round); setShowRoundForm(true); }} className="p-1 bg-blue-100 text-blue-700 rounded" title="Editar"><Edit2 size={13} /></button>
          <button onClick={() => confirm('Excluir esta rodada?') && deleteRound(round.id)} className="p-1 bg-red-100 text-red-700 rounded" title="Excluir"><Trash2 size={13} /></button>
        </div>
      </div>
    );
  };

  // Linha compacta — para rodadas finalizadas
  const renderFinishedRoundRow = (round) => {
    const dateRange = getRoundDateRange(round);
    return (
      <div key={round.id} className="flex items-center justify-between py-2.5 px-3 hover:bg-gray-50 rounded-lg transition-colors group">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-8 text-center text-sm font-bold text-gray-400">{round.number}</span>
          <div className="min-w-0">
            <span className="text-sm font-medium text-gray-700">{round.name}</span>
            {dateRange && <span className="ml-2 text-xs text-gray-400">{dateRange}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full hidden sm:inline">Finalizada</span>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => generateRoundPDF(round.id)} disabled={pdfLoadingRoundId === round.id} className="p-1 bg-purple-100 text-purple-700 rounded disabled:opacity-40" title="PDF palpites">
              {pdfLoadingRoundId === round.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            </button>
            <button onClick={() => generateFinalizedRoundReportPDF(round.id)} disabled={pdfLoadingRoundId === ('final-' + round.id)} className="p-1 bg-purple-100 text-purple-700 rounded disabled:opacity-40" title="Relatório oficial">
              {pdfLoadingRoundId === ('final-' + round.id) ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
            </button>
            <button onClick={() => { setEditingRound(round); setShowRoundForm(true); }} className="p-1 bg-blue-100 text-blue-700 rounded" title="Editar"><Edit2 size={13} /></button>
          </div>
        </div>
      </div>
    );
  };

  const adminTabMeta = [
    { id: 'dashboard',      label: 'Dashboard',       icon: <Trophy size={18} />    },
    { id: 'rounds',         label: 'Rodadas',          icon: <Calendar size={18} />  },
    { id: 'teams',          label: 'Times',            icon: <Users size={18} />     },
    { id: 'establishments', label: 'Estabelecimentos', icon: <Store size={18} />     },
    { id: 'participants',   label: 'Participantes',    icon: <TrendingUp size={18} />},
    { id: 'financial',      label: 'Financeiro',       icon: <DollarSign size={18} />},
    { id: 'communications', label: 'Comunicados',      icon: <Megaphone size={18} /> },
    { id: 'settings',       label: 'Configurações',    icon: <Edit2 size={18} />     },
    // A carteira da plataforma NÃO mora aqui: administrar o SaaS e administrar
    // um bolão são trabalhos diferentes, e misturá-los numa aba foi o que fez
    // a operação da Lion Tech ficar a um clique de dentro do bolão de cliente.
    // O console vive em /plataforma.
  ];
  const activeTabLabel = adminTabMeta.find(t => t.id === activeTab)?.label || '';

  return (
    <div className="min-h-screen font-body flex page-bg">

      {/* Bloqueio tem prioridade sobre o assistente: sem pagar, não há o que
          configurar. */}
      {subStatus === STATUS.BLOCKED && !bloqueioDispensado && (
        <ModalBloqueio tenantId={tenantId} aoFechar={() => setBloqueioDispensado(true)} />
      )}
      {mostrarWizard && subStatus !== STATUS.BLOCKED && <SetupWizard aoFechar={encerrarWizard} />}
      {mostrarTour && (
        <GuidedTour passos={PASSOS_TOUR} aoTrocarAba={setActiveTab} aoFechar={encerrarTour} />
      )}

      {/* ═══════════════════════════════════
          SIDEBAR — dark navigation rail
          ═══════════════════════════════════ */}
      <aside className="w-14 md:w-60 bg-white dark:bg-noite-900 border-r border-gray-200 dark:border-transparent fixed inset-y-0 left-0 z-20 flex flex-col shadow-sm dark:shadow-sidebar transition-colors duration-200">
        {/* Logo */}
        <div className="flex items-center gap-3 px-3 md:px-4 py-5 border-b border-gray-100 dark:border-white/8 flex-shrink-0">
          <div className="w-9 h-9 bg-campo-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <Trophy size={17} className="text-ouro-500" />
          </div>
          <div className="hidden md:block min-w-0">
            <p className="font-display text-noite-800 dark:text-white text-base leading-none" style={{ letterSpacing: '0.15em' }}>BOLÃO</p>
            <p className="text-noite-400 dark:text-noite-500 text-xs font-medium" style={{ letterSpacing: '0.1em' }}>ADMIN · 2026</p>
          </div>
        </div>

        {/* Nav items */}
        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
          {adminTabMeta.map(({ id, label, icon }) => (
            <button
              key={id}
              data-tour={`aba-${id}`}
              onClick={() => setActiveTab(id)}
              className={`w-full flex items-center gap-3 px-2 md:px-3 py-2.5 rounded-lg transition-all duration-150 text-sm font-medium border-l-2 ${
                activeTab === id
                  ? 'sidebar-active'
                  : 'border-transparent text-noite-400 hover:text-noite-800 hover:bg-gray-50 dark:hover:text-white dark:hover:bg-white/6'
              }`}
            >
              <span className="flex-shrink-0">{icon}</span>
              <span className="hidden md:block whitespace-nowrap">{label}</span>
            </button>
          ))}
        </nav>

        {/* User + logout */}
        <div className="border-t border-gray-100 dark:border-white/8 p-3 flex-shrink-0">
          <div className="hidden md:flex items-center gap-2.5 mb-3 px-1">
            <div className="w-8 h-8 bg-campo-600 dark:bg-campo-700 rounded-lg flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
              {currentUser?.name?.[0]?.toUpperCase() || 'A'}
            </div>
            <div className="min-w-0">
              <p className="text-noite-800 dark:text-white text-xs font-semibold truncate">{currentUser?.name}</p>
              <p className="text-noite-400 dark:text-noite-500 text-xs">Administrador</p>
            </div>
          </div>
          <button
            onClick={() => { logout(); setView('login'); }}
            className="w-full flex items-center justify-center md:justify-start gap-2 text-noite-400 hover:text-noite-800 hover:bg-gray-50 dark:hover:text-white dark:hover:bg-white/8 px-2 py-2 rounded-lg text-sm transition-colors duration-150"
          >
            <LogOut size={16} />
            <span className="hidden md:block">Sair</span>
          </button>
        </div>
      </aside>

      {/* ═══════════════════════════════════
          MAIN — content area
          ═══════════════════════════════════ */}
      <div className="ml-14 md:ml-60 flex-1 flex flex-col min-h-screen">
        {/* Top bar */}
        <div className="bg-white border-b border-gray-200 sticky top-0 z-10 px-4 sm:px-6 py-3.5 flex items-center justify-between flex-shrink-0">
          <div>
            <h1 className="font-display text-2xl text-noite-900 leading-none" style={{ letterSpacing: '0.06em' }}>{activeTabLabel.toUpperCase()}</h1>
            <p className="text-noite-400 text-xs mt-0.5 font-medium">Bolão Brasileirão 2026</p>
          </div>
          <div className="flex items-center gap-2">
            {rounds.filter(r => r.status === 'open').length > 0 && (
              <span className="hidden sm:flex items-center gap-1.5 bg-campo-50 text-campo-800 border border-campo-200 text-xs font-semibold px-2.5 py-1.5 rounded-full">
                <span className="w-1.5 h-1.5 bg-campo-500 rounded-full animate-pulse-dot" />
                {rounds.filter(r => r.status === 'open').length} aberta{rounds.filter(r => r.status === 'open').length > 1 ? 's' : ''}
              </span>
            )}
            <DarkToggle variant="light" />
          </div>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 flex-1">
        <SubscriptionBanner onStatus={setSubStatus} />

        {/* Bloqueado: o organizador entra e navega, mas as ferramentas ficam
            fora do ar até pagar. Trancá-lo para fora da conta tiraria dele
            justamente a tela onde está o botão de pagamento. */}
        {/* Configurações continua acessível mesmo bloqueado: é lá que ele paga
            a mensalidade e ajusta a conta de recebimento. Travar isso junto
            deixaria o organizador sem caminho para se regularizar. */}
        {subStatus === STATUS.BLOCKED && activeTab !== 'settings' ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center max-w-2xl mx-auto mt-4">
            <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
              <AlertCircle size={28} className="text-red-600" />
            </div>
            <h2 className="font-display text-2xl text-noite-900 mb-2" style={{ letterSpacing: '0.04em' }}>FERRAMENTAS BLOQUEADAS</h2>
            <p className="text-noite-500 text-sm leading-relaxed max-w-md mx-auto">
              Sua conta continua ativa e o histórico do bolão segue aqui, mas enquanto a
              mensalidade estiver em aberto você não consegue abrir rodadas, e os
              participantes não conseguem enviar palpites.
            </p>
            <p className="text-noite-500 text-sm leading-relaxed max-w-md mx-auto mt-3">
              Use o botão <strong>Ativar meu bolão</strong> acima, ou vá em
              Configurações. A liberação é automática assim que o PIX for confirmado.
            </p>
            <button onClick={() => setActiveTab('settings')} className="v2-btn-outline px-5 py-2.5 text-sm mt-5">
              <Edit2 size={16} /> Abrir Configurações
            </button>
          </div>
        ) : (
        <>
        {activeTab === 'dashboard' && (
          <div>
            <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4 mb-6">
              <div>
                <h2 className="text-2xl font-bold">Dashboard por Rodada</h2>
                <p className="text-gray-600 mt-1">Premiação: 85% • Admin: 10% • Estabelecimentos: 5% por palpite vinculado</p>
              </div>
              <div className="w-full md:w-64">
                <label className="block text-xs md:text-sm font-medium mb-2">Selecione a Rodada</label>
                <select
                  value={selectedDashboardRound || ''}
                  onChange={(e) => setSelectedDashboardRound(e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg bg-white"
                >
                  {rounds.filter(r => r.status === 'finished' || r.status === 'closed').length === 0 && (
                    <option value="">Nenhuma rodada fechada ou finalizada</option>
                  )}
                  {rounds
                    .filter(r => r.status === 'finished' || r.status === 'closed')
                    .sort((a, b) => {
                      const toTs = (r) => {
                        if (r?.closeAt) {
                          const t = new Date(r.closeAt).getTime();
                          if (!isNaN(t)) return t;
                        }
                        const ca = r?.createdAt;
                        if (ca && typeof ca.toDate === 'function') return ca.toDate().getTime();
                        if (ca && typeof ca === 'object' && typeof ca.seconds === 'number') return ca.seconds * 1000;
                        return typeof r?.number === 'number' ? r.number : 0;
                      };
                      return toTs(b) - toTs(a);
                    })
                    .map(round => (
                      <option key={round.id} value={round.id}>
                        {round.name} {round.status === 'closed' ? '• Parcial' : ''}
                      </option>
                    ))}
                </select>
              </div>
            </div>
            
            {(() => {
              if (!dashboardData) {
                return (
                  <div className="bg-white rounded-xl p-12 text-center border-2 border-dashed">
                    <Trophy className="mx-auto text-gray-400 mb-4" size={48} />
                    <h3 className="text-xl font-semibold mb-2">Nenhuma rodada fechada ou finalizada</h3>
                    <p className="text-gray-500">O dashboard aparece para rodadas fechadas (parcial) e finalizadas (final)</p>
                  </div>
                );
              }

              // Calcular comissões individuais por estabelecimento
              const establishmentCommissions = {};
              dashboardData.ranking.forEach(r => {
                if (r.establishmentId) {
                  if (!establishmentCommissions[r.establishmentId]) {
                    establishmentCommissions[r.establishmentId] = {
                      total: 0,
                      count: 0
                    };
                  }
                  // 5% sobre CADA palpite deste estabelecimento
                  establishmentCommissions[r.establishmentId].total += dashboardData.betValue * 0.05;
                  establishmentCommissions[r.establishmentId].count += 1;
                }
              });

              return (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    {/* Arrecadado */}
                    <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-card hover:shadow-card-hover transition-shadow duration-200 group">
                      <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center mb-3">
                        <DollarSign className="text-blue-500" size={17} />
                      </div>
                      <p className="text-noite-400 text-xs font-semibold uppercase mb-1" style={{ letterSpacing: '0.06em' }}>Arrecadado</p>
                      <p className="font-display text-blue-700 leading-none mb-1" style={{ fontSize: '1.6rem' }}>R$ {dashboardData.totalPaid.toFixed(2)}</p>
                      <p className="text-xs text-gray-400">{dashboardData.paidCount} pagamentos</p>
                    </div>
                    {/* Premiação */}
                    <div className="bg-noite-900 rounded-2xl p-5 shadow-card hover:shadow-card-hover transition-shadow duration-200 group">
                      <div className="w-9 h-9 bg-ouro-500/15 rounded-xl flex items-center justify-center mb-3">
                        <Trophy className="text-ouro-400" size={17} />
                      </div>
                      <p className="text-noite-500 text-xs font-semibold uppercase mb-1" style={{ letterSpacing: '0.06em' }}>Premiação 85%</p>
                      <p className="font-display text-ouro-400 leading-none mb-1" style={{ fontSize: '1.6rem' }}>R$ {dashboardData.prizePool.toFixed(2)}</p>
                      {dashboardData.round.status === 'finished' && <p className="text-xs text-noite-500">Para {dashboardData.winners.length} vencedor(es)</p>}
                      {dashboardData.round.status === 'closed' && <p className="text-xs text-noite-500">Definida na finalização</p>}
                    </div>
                    {/* Taxa admin */}
                    <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-card hover:shadow-card-hover transition-shadow duration-200">
                      <div className="w-9 h-9 bg-campo-50 rounded-xl flex items-center justify-center mb-3">
                        <Award className="text-campo-600" size={17} />
                      </div>
                      <p className="text-noite-400 text-xs font-semibold uppercase mb-1" style={{ letterSpacing: '0.06em' }}>Admin 10%</p>
                      <p className="font-display text-campo-700 leading-none mb-1" style={{ fontSize: '1.6rem' }}>R$ {dashboardData.adminFee.toFixed(2)}</p>
                    </div>
                    {/* Estabelecimentos */}
                    <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-card hover:shadow-card-hover transition-shadow duration-200">
                      <div className="w-9 h-9 bg-orange-50 rounded-xl flex items-center justify-center mb-3">
                        <Store className="text-orange-500" size={17} />
                      </div>
                      <p className="text-noite-400 text-xs font-semibold uppercase mb-1" style={{ letterSpacing: '0.06em' }}>Estabelec. 5%</p>
                      <p className="font-display text-orange-700 leading-none mb-1" style={{ fontSize: '1.6rem' }}>R$ {dashboardData.establishmentFee.toFixed(2)}</p>
                      <p className="text-xs text-gray-400">Por palpite vinculado</p>
                    </div>
                    {/* Participantes */}
                    <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-card hover:shadow-card-hover transition-shadow duration-200">
                      <div className="w-9 h-9 bg-gray-100 rounded-xl flex items-center justify-center mb-3">
                        <Users className="text-gray-500" size={17} />
                      </div>
                      <p className="text-noite-400 text-xs font-semibold uppercase mb-1" style={{ letterSpacing: '0.06em' }}>Participantes</p>
                      <p className="font-display text-noite-800 leading-none mb-1" style={{ fontSize: '1.6rem' }}>{dashboardData.totalParticipations}</p>
                      <p className="text-xs text-gray-400">{dashboardData.paidCount} pagos</p>
                    </div>
                  </div>

                  {/* Comissões por Estabelecimento */}
                  {Object.keys(establishmentCommissions).length > 0 && (
                    <div className="bg-white rounded-xl shadow-sm border p-6">
                      <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                        <Store size={24} className="text-orange-600" />
                        Comissões por Estabelecimento (5% por palpite vinculado)
                      </h3>
                      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <p className="text-sm text-blue-800">
                          <strong>💡 Como funciona:</strong> Cada estabelecimento recebe 5% apenas dos palpites feitos nele.
                        </p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                        {Object.entries(establishmentCommissions).map(([estId, data]) => {
                          const est = establishments.find(e => e.id === estId);
                          if (!est) return null;
                          return (
                            <div key={estId} className="bg-orange-50 border-2 border-orange-200 rounded-lg p-4">
                              <div className="flex items-start justify-between mb-2">
                                <p className="font-bold text-lg flex-1">{est.name}</p>
                                <Store className="text-orange-600 flex-shrink-0" size={20} />
                              </div>
                              <p className="text-3xl font-bold text-orange-600 mb-2">R$ {data.total.toFixed(2)}</p>
                              <div className="text-xs text-gray-600 space-y-1">
                                <p><strong>{data.count}</strong> palpite(s) neste estabelecimento</p>
                                <p className="text-orange-700 font-medium">
                                  {data.count} × R$ {dashboardData.betValue.toFixed(2)} × 5% = R$ {data.total.toFixed(2)}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                        <p className="text-sm text-green-800">
                          <strong>Total de comissões:</strong> R$ {Object.values(establishmentCommissions).reduce((sum, d) => sum + d.total, 0).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Vencedores / Premiação (apenas quando finalizada) */}
                  {dashboardData.round.status === 'finished' && (
                  <div className="bg-gradient-to-br from-yellow-400 via-yellow-500 to-orange-500 rounded-xl p-8 text-white">
                    <div className="flex items-center gap-3 mb-6">
                      <Trophy size={48} />
                      <div>
                        <h3 className="text-3xl font-bold">Premiação - {dashboardData.round.name}</h3>
                        <p className="text-yellow-100">
                          {dashboardData.winners.length > 1 ? `${dashboardData.winners.length} Vencedores (Empate)` : 'Campeão da Rodada'}
                        </p>
                      </div>
                    </div>

                    {dashboardData.winners.length === 0 ? (
                      <div className="bg-white bg-opacity-20 rounded-xl p-8 text-center">
                        <p className="text-xl font-semibold">Nenhum participante pagou</p>
                        <p className="text-yellow-100 mt-2">Aguardando confirmação de pagamentos</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="bg-white bg-opacity-20 rounded-xl p-6">
                          <div className="text-center mb-4">
                            <p className="text-yellow-100 text-sm font-medium">PRÊMIO {dashboardData.winners.length > 1 ? 'POR VENCEDOR' : 'TOTAL'} (85%)</p>
                            <p className="text-5xl font-bold mt-2">R$ {dashboardData.prizePerWinner.toFixed(2)}</p>
                          </div>
                        </div>

                        <div className="bg-white bg-opacity-20 rounded-xl p-6">
                          <h4 className="text-xl font-bold mb-4 flex items-center gap-2">
                            <Award size={24} />
                            {dashboardData.winners.length > 1 ? 'Vencedores' : '🏆 Campeão'}
                          </h4>
                          <div className="space-y-3">
                            {dashboardData.winners.map((winner) => {
                              const est = establishments.find(e => e.id === winner.establishmentId);
                              return (
                                <div key={`${winner.user.id}-${winner.cartelaCode}`} className="bg-white rounded-lg p-4 text-gray-900 flex justify-between items-center">
                                  <div>
                                    <p className="font-bold text-lg">{winner.user.name}</p>
                                    <p className="text-sm text-gray-600">{winner.user.whatsapp}</p>
                                    <p className="text-xs text-blue-600 font-mono mt-1">🎫 {winner.cartelaCode}</p>
                                    {est && <p className="text-xs text-orange-600 mt-1">🏪 {est.name}</p>}
                                  </div>
                                  <div className="text-right">
                                    <p className="text-2xl font-bold text-green-600">{winner.points} pts</p>
                                    <p className="text-sm font-medium text-green-700">R$ {dashboardData.prizePerWinner.toFixed(2)}</p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {dashboardData.winners.length > 1 && (
                          <div className="bg-white bg-opacity-20 rounded-xl p-4 text-center">
                            <p className="text-sm">⚠️ Empate! Premiação dividida igualmente entre os vencedores.</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  )}

                  {/* Ranking Completo da Rodada */}
                  <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                    <div className="bg-gray-50 p-4 border-b">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-bold">Ranking Completo</h3>
                        <div className="flex items-center gap-2">
                          {dashboardData.round.status === 'closed' && (
                            <span className="text-xs font-medium text-yellow-600">Resultados parciais (rodada fechada)</span>
                          )}
                          <button
                            onClick={() => generateTop5PDF(dashboardData.round.id)}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs sm:text-sm ${pdfLoadingRoundId === 'top5-' + dashboardData.round.id ? 'bg-purple-100 text-purple-400 opacity-60 cursor-not-allowed' : 'bg-purple-100 text-purple-700 hover:bg-purple-200'}`}
                            aria-busy={pdfLoadingRoundId === 'top5-' + dashboardData.round.id}
                            disabled={pdfLoadingRoundId === 'top5-' + dashboardData.round.id}
                          >
                            {pdfLoadingRoundId === 'top5-' + dashboardData.round.id ? (
                              <Loader2 size={16} className="animate-spin" />
                            ) : (
                              <Download size={16} />
                            )}
                            <span>Top 5 PDF</span>
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-100 border-b">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Pos</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nome</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Estabelecimento</th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Pontos</th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Prêmio</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {dashboardData.ranking.map((item, index) => {
                            const isWinner = dashboardData.winners.some(w => w.user.id === item.user.id && w.cartelaCode === item.cartelaCode);
                            const est = establishments.find(e => e.id === item.establishmentId);
                            
                            // Calcular posição considerando empates
                            let position = 1;
                            let uniqueScores = [];
                            
                            // Coletar pontuações únicas maiores que a pontuação atual
                            for (let i = 0; i < dashboardData.ranking.length; i++) {
                              if (dashboardData.ranking[i].points > item.points && !uniqueScores.includes(dashboardData.ranking[i].points)) {
                                uniqueScores.push(dashboardData.ranking[i].points);
                              }
                            }
                            
                            // A posição é o número de pontuações únicas maiores + 1
                            position = uniqueScores.length + 1;
                            
                            return (
                              <tr key={`${item.user.id}-${item.cartelaCode}`} onClick={() => openAdminPlayerModal(dashboardData.round.id, item)} className={`${isWinner ? 'bg-yellow-50' : ''} cursor-pointer hover:bg-gray-50`}>
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold">{position}º</span>
                                  </div>
                                </td>
                                <td className="px-4 py-3">
                                  <div>
                                    <p className="font-medium">{item.user.name}</p>
                                    <p className="text-xs text-gray-500">{item.user.whatsapp}</p>
                                    <p className="text-xs text-blue-600 font-mono">🎫 {item.cartelaCode}</p>
                                  </div>
                                </td>
                                <td className="px-4 py-3">
                                  {est ? (
                                    <span className="text-sm text-orange-600 font-medium">{est.name}</span>
                                  ) : (
                                    <span className="text-xs text-gray-400">Nenhum</span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <span className="font-bold text-green-600">{item.points}</span>
                                </td>
                                <td className="px-4 py-3 text-center">
                                  {isWinner ? (
                                    <span className="font-bold text-green-600">R$ {dashboardData.prizePerWinner.toFixed(2)}</span>
                                  ) : (
                                    <span className="text-gray-400">-</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {activeTab === 'establishments' && (
          <div>
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
              <div>
                <h2 className="text-2xl font-bold">Pontos de venda</h2>
                <p className="text-gray-600 mt-1">
                  Parceiros que trazem apostadores e recebem comissão por isso
                </p>
              </div>
              <button onClick={() => { setEditingEstablishment(null); setShowEstablishmentForm(true); }} className="w-full sm:w-auto flex items-center justify-center gap-2 bg-green-600 text-white px-5 py-2.5 rounded-lg text-sm sm:text-base">
                <Plus size={20} /> Novo ponto de venda
              </button>
            </div>

            {/* Explicação de uso. A aba dizia só "gerenciar locais que indicam
                participantes", o que não conta como a coisa FUNCIONA nem por que
                alguém usaria — e sem isso o recurso fica parado. */}
            <div className="bg-white rounded-xl border p-6 mb-6">
              <h3 className="font-semibold mb-2 flex items-center gap-2">
                <Store size={18} className="text-orange-600" /> Como funciona
              </h3>
              <p className="text-sm text-gray-600 leading-relaxed mb-4">
                Serve para crescer o bolão com a ajuda de terceiros. Você cadastra o bar,
                a lotérica, a loja ou o amigo que arruma apostadores. Na hora de se
                cadastrar, o participante escolhe por qual ponto de venda ele veio — e o
                sistema passa a somar, separadamente, quanto cada um trouxe e quanto
                tem a receber de comissão.
              </p>
              <ol className="text-sm text-gray-600 space-y-2 mb-4 list-decimal list-inside">
                <li><strong>Cadastre o ponto de venda</strong> com nome, contato e o percentual de comissão dele.</li>
                <li><strong>Mande o link do bolão</strong> para o parceiro divulgar no balcão ou no grupo dele.</li>
                <li><strong>O participante escolhe o ponto de venda</strong> na tela de cadastro. Só aparece se houver algum cadastrado aqui.</li>
                <li><strong>Confira em Financeiro</strong>: dá para filtrar por ponto de venda e ver arrecadação e comissão de cada um.</li>
                <li><strong>Acerte a comissão</strong> com o parceiro quando fechar a rodada. O pagamento é por fora, direto com ele.</li>
              </ol>
              <div className="bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/30 rounded-lg p-3">
                <p className="text-sm text-orange-800 dark:text-orange-200">
                  A comissão sai da divisão da rodada, não do seu bolso: por padrão são
                  {' '}{PADRAO_ESTABELECIMENTO_PCT}% das cartelas <strong>que aquele ponto trouxe</strong>. O percentual
                  padrão fica em Configurações → Valor de Aposta, e cada ponto de venda pode
                  ter o seu.
                </p>
              </div>
            </div>

            {establishments.length === 0 ? (
              <div className="bg-white rounded-xl p-12 text-center border-2 border-dashed">
                <Store className="mx-auto text-gray-400 mb-4" size={48} />
                <h3 className="text-xl font-semibold mb-2">Nenhum ponto de venda cadastrado</h3>
                <p className="text-gray-500 text-sm max-w-md mx-auto">
                  Sem nenhum cadastrado aqui, a escolha de ponto de venda nem aparece no
                  cadastro do participante — o bolão funciona normalmente sem isso.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {establishments.map((est) => (
                  <div key={est.id} className="bg-white rounded-lg shadow-sm border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="bg-orange-100 p-2 rounded-md">
                          <Store className="text-orange-600" size={18} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium truncate max-w-[12rem] sm:max-w-[16rem]">{est.name}</p>
                          <p className="text-[11px] text-gray-600 truncate">{est.contact || 'Sem contato'}</p>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => { setEditingEstablishment(est); setShowEstablishmentForm(true); }} className="p-1.5 bg-blue-100 text-blue-700 rounded-md"><Edit2 size={14} /></button>
                        <button onClick={() => confirm('Excluir?') && deleteEstablishment(est.id)} className="p-1.5 bg-red-100 text-red-700 rounded-md"><Trash2 size={14} /></button>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">Telefone</span>
                        <span className="font-medium truncate">{est.phone || '-'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">Comissão</span>
                        <span className="font-bold text-orange-600">{est.commission || 5}%</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'settings' && (
          <div>
            <h2 className="text-2xl font-bold mb-6">Configurações</h2>
            <div className="bg-white rounded-xl border p-2 mb-6">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {[
                  { key: 'whatsapp', label: 'WhatsApp', icon: Send },
                  // Integrações (Woovi/grupo) são de plataforma — só o admin global vê.
                  ...(currentUser?.globalAdmin ? [{ key: 'integracoes', label: 'Integrações', icon: Key }] : []),
                  { key: 'maintenance', label: 'Manutenção', icon: AlertCircle },
                  { key: 'rules', label: 'Regras', icon: FileText },
                  { key: 'bet', label: 'Aposta', icon: DollarSign }
                ].map(t => (
                  <button key={t.key} onClick={() => setSettingsTab(t.key)} className={`flex-shrink-0 px-3 py-2 rounded-lg border whitespace-nowrap ${settingsTab === t.key ? 'bg-green-50 border-green-300 text-green-700' : 'bg-white border-gray-200 text-gray-700'}`}>
                    <span className="inline-flex items-center gap-1.5 text-sm"><t.icon size={16} />{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* WhatsApp Settings */}
            {settingsTab === 'whatsapp' && (
              <div className="space-y-6 max-w-3xl">
                {!currentUser?.globalAdmin && <ConviteCard />}
                {!currentUser?.globalAdmin && <RecebimentoAutomaticoCard />}
                {!currentUser?.globalAdmin && (
                  <div className="bg-white rounded-xl shadow-sm border p-6">
                    <h3 className="text-lg font-bold mb-2">Ajuda</h3>
                    <p className="text-sm text-gray-600 mb-4">
                      Refaça a configuração inicial se algo mudou, ou percorra o painel
                      para relembrar onde fica cada coisa.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <button onClick={() => setMostrarWizard(true)} className="v2-btn-outline px-5 py-2.5 text-sm">
                        <Edit2 size={16} /> Refazer configuração
                      </button>
                      <button onClick={() => setMostrarTour(true)} className="v2-btn-ghost px-5 py-2.5 text-sm">
                        <Bell size={16} /> Tour do painel
                      </button>
                    </div>
                  </div>
                )}
                {!currentUser?.globalAdmin && <MensalidadeCard />}
                {!currentUser?.globalAdmin && <WhatsAppConnectCard />}
                {currentUser?.globalAdmin && (
                <div className="bg-white rounded-xl shadow-sm border p-6">
                  <h3 className="text-lg font-bold mb-4">Credenciais e Notificações</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">Provedor do WhatsApp</label>
                      <select value={whatsappProvider} onChange={(e) => setWhatsappProvider(e.target.value)} className="w-full px-4 py-3 border rounded-lg">
                        <option value="evolution">Evolution API</option>
                        <option value="cloud">WhatsApp Cloud API</option>
                      </select>
                    </div>
                  </div>
                  {whatsappProvider === 'cloud' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium mb-2">Token da API</label>
                        <input type="text" value={whatsappApiToken} onChange={(e) => setWhatsappApiToken(e.target.value)} className="w-full px-4 py-3 border rounded-lg" placeholder="token" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2">Número associado (WhatsApp)</label>
                        <input type="text" value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} className="w-full px-4 py-3 border rounded-lg" placeholder="5599999999999" />
                      </div>
                    </div>
                  )}
                  {whatsappProvider === 'evolution' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="sm:col-span-2">
                        <label className="block text-sm font-medium mb-2">Link do servidor (Evolution)</label>
                        <input type="text" value={devolutionLink} onChange={(e) => setDevolutionLink(e.target.value)} className="w-full px-4 py-3 border rounded-lg" placeholder="https://seu-servidor-evolution" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2">Instância (Evolution)</label>
                        <input type="text" value={devolutionInstance} onChange={(e) => setDevolutionInstance(e.target.value)} className="w-full px-4 py-3 border rounded-lg" placeholder="minha-instancia" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2">Token (Evolution)</label>
                        <input type="text" value={devolutionToken} onChange={(e) => setDevolutionToken(e.target.value)} className="w-full px-4 py-3 border rounded-lg" placeholder="apikey" />
                      </div>
                    </div>
                  )}
                  <div className="mt-4 flex items-center gap-3">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={whatsappNotifyEnabled} onChange={(e) => setWhatsappNotifyEnabled(e.target.checked)} />
                      <span>Ativar notificações</span>
                    </label>
                  </div>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={!!whatsappNotifyEvents.charges} onChange={(e) => setWhatsappNotifyEvents({ ...whatsappNotifyEvents, charges: e.target.checked })} />Cobranças</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={!!whatsappNotifyEvents.approvals} onChange={(e) => setWhatsappNotifyEvents({ ...whatsappNotifyEvents, approvals: e.target.checked })} />Confirmações</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={!!whatsappNotifyEvents.results} onChange={(e) => setWhatsappNotifyEvents({ ...whatsappNotifyEvents, results: e.target.checked })} />Resultados</label>
                  </div>
                </div>
                )}

                <div className="bg-white rounded-xl shadow-sm border p-6">
                  <h3 className="text-lg font-bold mb-4">Template de Mensagens Padrão</h3>
                  <p className="text-gray-600 text-sm mb-4">Use {'{RODADA}'}, {'{CARTELA}'}, {'{PALPITES}'}, {'{PIX}'}, {'{DESTINATARIO}'}.</p>
                  <textarea value={whatsappMessage} onChange={(e) => setWhatsappMessage(e.target.value)} className="w-full px-4 py-3 border rounded-lg font-mono text-sm" rows="8" />
                  <div className="mt-4">
                    <label className="block text-sm font-medium mb-2">Template de Cobrança</label>
                    <textarea value={chargeMessageTemplate} onChange={(e) => setChargeMessageTemplate(e.target.value)} className="w-full px-4 py-3 border rounded-lg font-mono text-sm" rows="6" />
                  </div>
                  <div className="flex sm:justify-end gap-3 mt-4">
                    <button onClick={() => { setWhatsappApiToken(''); setWhatsappNumber(''); setDevolutionLink(''); setDevolutionInstance(''); setDevolutionToken(''); setWhatsappNotifyEnabled(true); setWhatsappNotifyEvents({ charges: true, approvals: true, results: true }); setWhatsappMessage(settings?.whatsappMessage || '🏆 *BOLÃO BRASILEIRÃO 2026*\n\n📋 *{RODADA}*\n🎫 *Cartela: {CARTELA}*\n✅ Confirmado!\n\n{PALPITES}\n\n🏦 Pagamento via PIX\n🔑 Chave: {PIX}\n👤 Destinatário: {DESTINATARIO}\n\n💰 R$ 15,00\n⚠️ *Não pode alterar após pagamento*\n\nBoa sorte! 🍀'); setChargeMessageTemplate(settings?.chargeMessageTemplate || 'Olá {NOME},\n\nIdentificamos que o pagamento da sua cartela da {RODADA} ainda está pendente.\n\nValor: R$ {VALOR}\nCartela: {CARTELA}\n\nPor favor, conclua o pagamento para validar sua participação no ranking e na premiação. Obrigado! 🙏'); }} className="px-6 py-2 border rounded-lg inline-flex items-center gap-2"><RefreshCcw size={16} />Restaurar Padrões</button>
                    <button onClick={handleSaveWhatsAppMessage} className="px-6 py-2 bg-green-600 text-white rounded-lg">Salvar</button>
                  </div>
                </div>
              </div>
            )}

            {/* Maintenance */}
            {settingsTab === 'maintenance' && (
              <div className="space-y-6 max-w-3xl">
                <div className="bg-white rounded-xl shadow-sm border p-6">
                  <h3 className="text-lg font-bold mb-4">Modo de Manutenção</h3>
                  <div className="flex items-center gap-3 mb-4">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={maintenanceMode} onChange={(e) => setMaintenanceMode(e.target.checked)} /><span>Ativar</span></label>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium mb-2">Mensagem</label>
                      <textarea value={maintenanceMessage} onChange={(e) => setMaintenanceMessage(e.target.value)} className="w-full px-4 py-3 border rounded-lg" rows="4" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Retorno Estimado</label>
                      <input type="datetime-local" value={maintenanceUntilInput} onChange={(e) => setMaintenanceUntilInput(e.target.value)} className="w-full px-4 py-3 border rounded-lg" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium mb-2">Acesso por IP (durante manutenção)</label>
                      <input type="text" value={maintenanceAllowedIps} onChange={(e) => setMaintenanceAllowedIps(e.target.value)} className="w-full px-4 py-3 border rounded-lg" placeholder="127.0.0.1, 10.0.0.1" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Agendar início</label>
                      <input type="datetime-local" value={maintenanceScheduleStart} onChange={(e) => setMaintenanceScheduleStart(e.target.value)} className="w-full px-4 py-3 border rounded-lg" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Agendar fim</label>
                      <input type="datetime-local" value={maintenanceScheduleEnd} onChange={(e) => setMaintenanceScheduleEnd(e.target.value)} className="w-full px-4 py-3 border rounded-lg" />
                    </div>
                  </div>
                  <div className="flex sm:justify-end gap-3 mt-4">
                    <button onClick={() => { setMaintenanceMode(false); setMaintenanceMessage('Estamos realizando uma manutenção programada para melhorar sua experiência. Por favor, tente novamente em breve.'); setMaintenanceUntilInput(''); setMaintenanceAllowedIps(''); setMaintenanceScheduleStart(''); setMaintenanceScheduleEnd(''); }} className="px-6 py-2 border rounded-lg inline-flex items-center gap-2"><RefreshCcw size={16} />Restaurar Padrões</button>
                    <button onClick={handleSaveWhatsAppMessage} className="px-6 py-2 bg-green-600 text-white rounded-lg">Salvar</button>
                  </div>
                </div>
              </div>
            )}

            {/* Rules */}
            {settingsTab === 'rules' && (
              <div className="space-y-6 max-w-3xl">
                <div className="bg-white rounded-xl shadow-sm border p-6">
                  <h3 className="text-lg font-bold mb-4">Termos, Políticas e Compliance</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">Termos de Uso</label>
                      <textarea value={termsOfUse} onChange={(e) => setTermsOfUse(e.target.value)} className="w-full px-4 py-3 border rounded-lg text-sm" rows="4" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Políticas do Sistema</label>
                      <textarea value={systemPolicies} onChange={(e) => setSystemPolicies(e.target.value)} className="w-full px-4 py-3 border rounded-lg text-sm" rows="4" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Limites e Restrições</label>
                      <textarea value={limitsRestrictions} onChange={(e) => setLimitsRestrictions(e.target.value)} className="w-full px-4 py-3 border rounded-lg text-sm" rows="4" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Configurações de Compliance</label>
                      <textarea value={complianceConfig} onChange={(e) => setComplianceConfig(e.target.value)} className="w-full px-4 py-3 border rounded-lg text-sm" rows="4" />
                    </div>
                  </div>
                  <div className="flex sm:justify-end gap-3 mt-4">
                    <button onClick={() => { setTermsOfUse(''); setSystemPolicies(''); setLimitsRestrictions(''); setComplianceConfig(''); }} className="px-6 py-2 border rounded-lg inline-flex items-center gap-2"><RefreshCcw size={16} />Restaurar Padrões</button>
                    <button onClick={handleSaveWhatsAppMessage} className="px-6 py-2 bg-green-600 text-white rounded-lg">Salvar</button>
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border p-6">
                  <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><FileText size={24} className="text-green-600" />Regras do Bolão</h3>
                  <div className="space-y-3">
                    <div className="flex gap-2 flex-wrap">
                      <button onClick={() => wrapSelection('**','**')} className="px-3 py-2 border rounded-lg text-sm font-semibold">N</button>
                      <button onClick={() => wrapSelection('*','*')} className="px-3 py-2 border rounded-lg text-sm italic">I</button>
                      <button onClick={() => makeList(false)} className="px-3 py-2 border rounded-lg text-sm">• Lista</button>
                      <button onClick={() => makeList(true)} className="px-3 py-2 border rounded-lg text-sm">1. Lista</button>
                    </div>
                    <textarea ref={rulesTextareaRef} value={rulesText} onChange={(e) => { initialLoadRef.current = false; setRulesText(e.target.value); }} className="w-full px-4 py-3 border rounded-lg text-sm" rows="8" />
                    <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                      <h4 className="font-semibold mb-2">Prévia formatada</h4>
                      <div className="text-sm text-gray-800" dangerouslySetInnerHTML={{ __html: markdownToHtml(rulesText) }} />
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border p-6">
                  <h3 className="text-lg font-bold mb-4">Critérios de Pontuação</h3>
                  <textarea value={scoringCriteria} onChange={(e) => { initialLoadRef.current = false; setScoringCriteria(e.target.value); }} className="w-full px-4 py-3 border rounded-lg text-sm" rows="6" />
                  <div className="mt-4 p-4 bg-gray-50 rounded-lg"><div className="text-sm text-gray-800" dangerouslySetInnerHTML={{ __html: markdownToHtml(scoringCriteria) }} /></div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border p-6">
                  <h3 className="text-lg font-bold mb-4">Regras de Desempate</h3>
                  <textarea value={tiebreakRules} onChange={(e) => { initialLoadRef.current = false; setTiebreakRules(e.target.value); }} className="w-full px-4 py-3 border rounded-lg text-sm" rows="6" />
                  <div className="mt-4 p-4 bg-gray-50 rounded-lg"><div className="text-sm text-gray-800" dangerouslySetInnerHTML={{ __html: markdownToHtml(tiebreakRules) }} /></div>
                  <div className="flex sm:justify-end gap-3 mt-4">
                    <button onClick={() => { setRulesText(DEFAULT_RULES_MD); setScoringCriteria(DEFAULT_SCORING_MD); setTiebreakRules(DEFAULT_TIEBREAK_MD); }} className="px-6 py-2 border rounded-lg inline-flex items-center gap-2"><RefreshCcw size={16} />Restaurar Padrões</button>
                    <button onClick={handleSaveWhatsAppMessage} className="px-6 py-2 bg-green-600 text-white rounded-lg">Salvar</button>
                  </div>
                </div>
              </div>
            )}

            {/* Bet Value */}
            {settingsTab === 'bet' && (
              <div className="space-y-6 max-w-3xl">
                <div className="bg-white rounded-xl shadow-sm border p-6">
                  <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><DollarSign size={24} className="text-green-600" />Valor de Aposta</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">Valor por Cartela (R$)</label>
                      <input type="number" min="1" step="0.50" value={betValue} onChange={(e) => setBetValue(e.target.value)} className="w-full px-4 py-3 border rounded-lg" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Mínimo (R$)</label>
                      <input type="number" min="0" step="0.50" value={minBet} onChange={(e) => setMinBet(e.target.value)} className="w-full px-4 py-3 border rounded-lg" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Máximo (R$)</label>
                      <input type="number" min="0" step="0.50" value={maxBet} onChange={(e) => setMaxBet(e.target.value)} className="w-full px-4 py-3 border rounded-lg" />
                    </div>
                  </div>
                  <div className="mt-4">
                    <label className="block text-sm font-medium mb-2">Limites por tipo de aposta</label>
                    <textarea value={limitsByTypeText} onChange={(e) => setLimitsByTypeText(e.target.value)} className="w-full px-4 py-3 border rounded-lg text-sm" rows="4" placeholder="Defina regras por tipo, ex.: Simples: máx 1 cartela; Duplas: máx 2, etc." />
                  </div>
                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={!!bonusEnabled} onChange={(e) => setBonusEnabled(e.target.checked)} />
                      <span>Bônus ativo</span>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Bônus (%)</label>
                      <input type="number" min="0" max="100" step="0.5" value={bonusPercent} onChange={(e) => setBonusPercent(e.target.value)} className="w-full px-4 py-3 border rounded-lg" />
                    </div>
                    <div className="hidden sm:block"></div>
                  </div>
                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">Taxa Admin (%)</label>
                      <input type="number" min="0" max="100" step="0.5" value={adminFeePercent} onChange={(e) => setAdminFeePercent(e.target.value)} className="w-full px-4 py-3 border rounded-lg" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Comissão Estabelecimento (%)</label>
                      <input type="number" min="0" max="100" step="0.5" value={establishmentPercent} onChange={(e) => setEstablishmentPercent(e.target.value)} className="w-full px-4 py-3 border rounded-lg" />
                    </div>
                  </div>
                  <div className="flex sm:justify-end gap-3 mt-4">
                    <button onClick={() => { setBetValue(15); setMinBet(10); setMaxBet(100); setBonusEnabled(false); setBonusPercent(0); setAdminFeePercent(10); setEstablishmentPercent(5); setLimitsByTypeText(''); }} className="px-6 py-2 border rounded-lg inline-flex items-center gap-2"><RefreshCcw size={16} />Restaurar Padrões</button>
                    <button onClick={handleSaveWhatsAppMessage} className="px-6 py-2 bg-green-600 text-white rounded-lg">Salvar</button>
                  </div>
                </div>
              </div>
            )}


            {/* Integrações (plataforma — só admin global) */}
            {settingsTab === 'integracoes' && currentUser?.globalAdmin && (
              <div className="space-y-6 max-w-3xl">
                <div className="bg-white rounded-xl shadow-sm border p-6">
                  <h3 className="text-lg font-bold mb-1">Woovi / OpenPix — PIX Automático</h3>
                  <p className="text-sm text-gray-500 mb-4">Configure o App ID da Woovi para ativar QR Code PIX e baixa automática de pagamentos.</p>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-1">App ID (Authorization Token)</label>
                      <div className="relative">
                        <input type={showWooviAppId ? 'text' : 'password'} value={wooviAppId} onChange={e => setWooviAppId(e.target.value)} placeholder="Q2xpZW50X0lk..." className="w-full px-3 py-2 pr-10 border rounded-lg text-sm font-mono" />
                        <button type="button" onClick={() => setShowWooviAppId(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                          {showWooviAppId ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">Encontre em: Woovi Dashboard → API/Plugins → App ID</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Webhook Secret</label>
                      <div className="relative">
                        <input type={showWooviSecret ? 'text' : 'password'} value={wooviWebhookSecret} onChange={e => setWooviWebhookSecret(e.target.value)} placeholder="Secret do webhook" className="w-full px-3 py-2 pr-10 border rounded-lg text-sm font-mono" />
                        <button type="button" onClick={() => setShowWooviSecret(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                          {showWooviSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">URL do webhook a configurar na Woovi: <span className="font-mono">{window.location.origin}/api/payments/woovi-webhook</span></p>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border p-6 space-y-4">
                  <h3 className="text-lg font-bold mb-1">Grupo WhatsApp (Resultados)</h3>
                  <p className="text-sm text-gray-500">JID do grupo onde o PDF de resultados será enviado automaticamente ao fim de cada rodada.</p>
                  <div>
                    <label className="block text-sm font-medium mb-1">JID do Grupo</label>
                    <input type="text" value={whatsappGroupJid} onChange={e => setWhatsappGroupJid(e.target.value)} placeholder="120363XXXXXXXXX@g.us" className="w-full px-3 py-2 border rounded-lg text-sm font-mono" />
                    <p className="text-xs text-gray-400 mt-1">Para obter o JID: envie uma mensagem ao grupo via EvolutionAPI e veja o campo "remoteJid" na resposta.</p>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button onClick={handleSaveWhatsAppMessage} className="px-6 py-2 bg-green-600 text-white rounded-lg">Salvar Integrações</button>
                </div>
              </div>
            )}

            {/* A/B Tests */}

            {/* Histórico de alterações */}
            <div className="mt-8 bg-white rounded-xl shadow-sm border p-6 max-w-3xl">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><History size={20} />Histórico de Alterações</h3>
              {settingsHistory.length === 0 ? (
                <p className="text-sm text-gray-600">Nenhuma alteração registrada ainda.</p>
              ) : (
                <div className="space-y-3">
                  {settingsHistory.map(item => (
                    <div key={item.id} className="border rounded-lg p-3">
                      <p className="text-sm text-gray-800"><span className="font-medium">Autor:</span> {item.actorName || 'Admin'}</p>
                      <p className="text-sm text-gray-800"><span className="font-medium">Campos:</span> {(item.changedFields || []).join(', ')}</p>
                      <p className="text-xs text-gray-600">{item.createdAt && typeof item.createdAt.toDate === 'function' ? item.createdAt.toDate().toLocaleString('pt-BR') : ''}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        
        {activeTab === 'rounds' && (
          <div>
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
              <h2 className="text-2xl font-bold">Gerenciar Rodadas</h2>
              <div className="flex gap-2 w-full sm:w-auto">
                <button
                  onClick={async () => {
                    setSyncRoundsLoading(true);
                    try {
                      const idToken = await getIdToken();
                      const res = await fetch('/api/rounds/sync', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ idToken, tenantId }),
                      });
                      const data = await res.json();
                      // Só anuncia sucesso quando houve sucesso: a versão
                      // anterior exibia "concluído" mesmo diante de 401.
                      if (!res.ok) throw new Error(data.error || `Falha (HTTP ${res.status})`);
                      alert(data.mensagem);
                    } catch (e) {
                      alert('Não foi possível buscar as rodadas: ' + e.message);
                    } finally {
                      setSyncRoundsLoading(false);
                    }
                  }}
                  disabled={syncRoundsLoading}
                  className="flex items-center justify-center gap-2 border border-green-600 text-green-700 px-4 py-2.5 rounded-lg text-sm disabled:opacity-50"
                >
                  {syncRoundsLoading ? <Loader2 size={18} className="animate-spin" /> : <RefreshCcw size={18} />}
                  Sincronizar da API
                </button>
                <button
                  onClick={async () => {
                    setDryRunLoading(true);
                    setDryRunResult(null);
                    try {
                      const res = await fetch('/api/cron/sync-scores?dryRun=true', { method: 'GET' });
                      const data = await res.json();
                      setDryRunResult(data);
                    } catch (e) {
                      setDryRunResult({ error: e.message });
                    } finally {
                      setDryRunLoading(false);
                    }
                  }}
                  disabled={dryRunLoading}
                  className="flex items-center justify-center gap-2 border border-blue-500 text-blue-600 px-4 py-2.5 rounded-lg text-sm disabled:opacity-50"
                  title="Simula a finalização sem alterar nada no banco"
                >
                  {dryRunLoading ? <Loader2 size={18} className="animate-spin" /> : <Eye size={18} />}
                  Simular Finalização
                </button>
                <button onClick={() => { setEditingRound(null); setShowRoundForm(true); }} className="flex items-center justify-center gap-2 bg-green-600 text-white px-5 py-2.5 rounded-lg text-sm sm:text-base">
                  <Plus size={20} /> Adicionar rodada manual
                </button>
              </div>
            </div>
            {rounds.length === 0 ? (
              <div className="bg-white rounded-xl p-12 text-center border-2 border-dashed">
                <Calendar className="mx-auto text-gray-400 mb-4" size={48} />
                <h3 className="text-xl font-semibold mb-2">Nenhuma rodada</h3>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Abertas — card completo */}
                {openRounds.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>
                      Abertas <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-xs">{openRounds.length}</span>
                    </h3>
                    <div className="grid gap-3">{openRounds.map(renderRoundCard)}</div>
                  </div>
                )}

                {/* Fechadas — card completo */}
                {closedRounds.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-yellow-500 inline-block"></span>
                      Fechadas <span className="bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full text-xs">{closedRounds.length}</span>
                    </h3>
                    <div className="grid gap-3">{closedRounds.map(renderRoundCard)}</div>
                  </div>
                )}

                {/* Finalizadas — lista compacta */}
                {finishedRounds.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-blue-500 inline-block"></span>
                      Finalizadas <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs">{finishedRounds.length}</span>
                    </h3>
                    <div className="bg-white rounded-xl border divide-y divide-gray-100">
                      {finishedRounds.map(renderFinishedRoundRow)}
                    </div>
                  </div>
                )}

                {/* Futuras — lista compacta */}
                {upcomingRounds.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-gray-400 inline-block"></span>
                      Futuras <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs">{upcomingRounds.length}</span>
                    </h3>
                    <div className="bg-white rounded-xl border divide-y divide-gray-100">
                      {upcomingRounds.map(renderRoundRow)}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Modal de resultado da simulação de finalização */}
            {dryRunResult && (
              <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
                <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-xl">
                  <div className="flex items-center justify-between p-5 border-b">
                    <div className="flex items-center gap-3">
                      <Eye size={22} className="text-blue-600" />
                      <h3 className="text-lg font-bold">Simulação de Finalização</h3>
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">Nenhum dado alterado</span>
                    </div>
                    <button onClick={() => setDryRunResult(null)} className="text-gray-400 hover:text-gray-700 p-1"><X size={20} /></button>
                  </div>

                  <div className="overflow-y-auto p-5 space-y-4 flex-1">
                    {dryRunResult.error ? (
                      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{dryRunResult.error}</div>
                    ) : (
                      <>
                        {/* Logs gerais */}
                        {(dryRunResult.logs || []).length > 0 && (
                          <div className="bg-gray-50 rounded-xl p-4">
                            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Log da execução</p>
                            <ul className="space-y-1">
                              {dryRunResult.logs.map((l, i) => (
                                <li key={i} className="text-sm text-gray-700 font-mono">{l}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Relatório por rodada */}
                        {(dryRunResult.report || []).length === 0 ? (
                          <div className="text-center py-8 text-gray-500 text-sm">Nenhuma rodada fechada com jogos pendentes no momento.</div>
                        ) : (
                          dryRunResult.report.map((r, i) => (
                            <div key={i} className="border rounded-xl overflow-hidden">
                              {/* Cabeçalho da rodada */}
                              <div className={`px-4 py-3 flex items-center justify-between ${r.allMatchesFinished ? 'bg-green-50 border-b border-green-100' : 'bg-yellow-50 border-b border-yellow-100'}`}>
                                <span className="font-semibold text-gray-800">{r.round}</span>
                                <span className={`text-xs px-2 py-1 rounded-full font-medium ${r.allMatchesFinished ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                  {r.allMatchesFinished ? '✅ Todos os jogos finalizados' : '⏳ Jogos pendentes'}
                                </span>
                              </div>

                              <div className="p-4 space-y-4">
                                {/* Jogos */}
                                <div>
                                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Placares da API</p>
                                  <div className="space-y-1">
                                    {(r.matches || []).map((m, j) => (
                                      <div key={j} className="flex items-center justify-between text-sm py-1 border-b border-gray-50 last:border-0">
                                        <span className="text-gray-700">{m.home} × {m.away}</span>
                                        <div className="flex items-center gap-3">
                                          <span className={`font-mono font-bold ${m.finished ? 'text-gray-900' : 'text-gray-400'}`}>{m.score}</span>
                                          <span className={`text-xs px-1.5 py-0.5 rounded ${m.finished ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                            {m.finished ? 'FIM' : 'pendente'}
                                          </span>
                                          <span className="text-xs text-gray-400">{m.source}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                {/* Ranking simulado (só aparece se todos os jogos terminaram) */}
                                {r.allMatchesFinished && (r.ranking || []).length > 0 && (
                                  <div>
                                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Ranking que seria gerado</p>
                                    <div className="space-y-1">
                                      {r.ranking.map((p, k) => (
                                        <div key={k} className="flex items-center gap-3 text-sm py-1">
                                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${k === 0 ? 'bg-yellow-400 text-white' : k === 1 ? 'bg-gray-300 text-gray-700' : k === 2 ? 'bg-orange-300 text-white' : 'bg-gray-100 text-gray-600'}`}>{k + 1}</span>
                                          <span className="flex-1 text-gray-800">{p.name}</span>
                                          <span className="font-bold text-gray-900">{p.points} pts</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* O que aconteceria */}
                                <div className={`rounded-lg px-3 py-2 text-sm ${r.allMatchesFinished ? 'bg-green-50 text-green-800' : 'bg-gray-50 text-gray-600'}`}>
                                  <span className="font-medium">Ação: </span>{r.action}
                                </div>
                                {r.allMatchesFinished && (
                                  <div className="bg-blue-50 rounded-lg px-3 py-2 text-sm text-blue-800">
                                    <span className="font-medium">Envio: </span>{r.wouldSendTo} {r.wouldSendPdf ? '· com PDF' : '· sem PDF (grupo não configurado)'}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </>
                    )}
                  </div>

                  <div className="p-4 border-t flex justify-end">
                    <button onClick={() => setDryRunResult(null)} className="px-5 py-2 bg-gray-800 text-white rounded-lg text-sm">Fechar</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'teams' && (
          <div>
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
              <div>
                <h2 className="text-2xl font-bold">Gerenciar Times</h2>
                <div className="flex items-center gap-3 mt-2">
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${teams.length === 20 ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                    {teams.length} times cadastrados
                  </span>
                  {teams.length !== 20 && (
                    <span className="text-sm text-orange-600">⚠️ Deve ter exatamente 20 times</span>
                  )}
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto sm:items-end">

                <button onClick={handleFixTeamsDuplicates} className="w-full sm:w-auto flex items-center justify-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 text-sm sm:text-base">
                  <CheckCircle size={20} /> Corrigir duplicados
                </button>
                <button onClick={() => { setEditingTeam(null); setShowTeamForm(true); }} className="w-full sm:w-auto flex items-center justify-center gap-2 bg-green-600 text-white px-5 py-2.5 rounded-lg text-sm sm:text-base">
                  <Plus size={20} /> Novo Time
                </button>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow mb-6 p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-lg font-bold">Fila de Importação de Times</h3>
                  <p className="text-sm text-gray-600">Requisições pendentes aguardando aprovação</p>
                </div>
                <button onClick={submitImportRequestsFromApi} className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 text-sm">
                  <RefreshCcw size={18} /> Buscar times da API
                </button>
              </div>
              <div className="space-y-2">
                {(teamImportRequests || []).filter(r => r.status === 'pending').length === 0 ? (
                  <div className="text-sm text-gray-500">Nenhuma solicitação pendente.</div>
                ) : (
                  (teamImportRequests || []).filter(r => r.status === 'pending').map(req => (
                    <div key={req.id} className="flex items-center justify-between border rounded p-3">
                      <div className="flex items-center gap-3">
                        <img src={getSafeLogo({ name: req.name, logo: req.logo })} alt={req.name} className="w-8 h-8 object-contain rounded bg-white ring-1 ring-gray-200" />
                        <div>
                          <div className="font-medium">{req.name}</div>
                          <div className="text-xs text-gray-500">{req.normalizedName}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-1 text-xs rounded bg-yellow-100 text-yellow-700">pendente</span>
                        <button onClick={() => approveImportRequest(req.id)} className="text-white bg-green-600 hover:bg-green-700 px-3 py-1.5 rounded text-sm">Aprovar</button>
                        <button onClick={() => {
                          const reason = window.prompt('Motivo da rejeição (opcional):') || '';
                          rejectImportRequest(req.id, reason);
                        }} className="text-white bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded text-sm">Rejeitar</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {teams.map((team) => {
                const protectedStatuses = new Set(['open','closed','finished']);
                const isProtected = rounds.some(r => protectedStatuses.has(r?.status) && Array.isArray(r?.matches) && r.matches.some(m => m.homeTeamId === team.id || m.awayTeamId === team.id));
                return (
                  <div key={team.id} className="bg-white rounded-lg shadow-sm border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <img src={getSafeLogo(team)} alt={team.name} className="w-12 h-12 object-contain rounded bg-white ring-1 ring-gray-200" width={48} height={48} />
                        <span className="font-medium truncate max-w-[12rem] sm:max-w-[16rem]">{team.name}</span>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => { setEditingTeam(team); setShowTeamForm(true); }} className="p-1.5 bg-blue-100 text-blue-700 rounded-md"><Edit2 size={14} /></button>
                        <button disabled={isProtected} onClick={() => !isProtected && confirm('Excluir?') && deleteTeam(team.id)} className={`p-1.5 rounded-md ${isProtected ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-red-100 text-red-700'}`} title={isProtected ? 'Time vinculado a rodadas — exclusão bloqueada' : 'Excluir'}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    {isProtected && (<p className="text-[11px] text-amber-600 mt-1">Vinculado a rodadas ativas/fechadas/finalizadas</p>)}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'participants' && (
          <div>
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
              <h2 className="text-2xl font-bold">Participantes</h2>
              {/* Varre a coleção global de usuários: é manutenção da
                  plataforma, e o dono de um bolão nem tem permissão para isso. */}
              {currentUser?.globalAdmin && (
                <button onClick={handleFixUserDuplicates} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm sm:text-base w-full sm:w-auto justify-center">
                  <CheckCircle size={20} /> Corrigir duplicados
                </button>
              )}
            </div>
            <div className="grid gap-4">
              {users.filter(u => !u.isAdmin).map((user) => {
                const userPreds = predictions.filter(p => p.userId === user.id);
                return (
                  <div key={user.id} className="bg-white rounded-xl shadow-sm border p-6">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                      <div>
                        <h3 className="text-lg font-bold">{user.name}</h3>
                        <p className="text-gray-600 text-sm">{user.whatsapp}</p>
                        {user.email && <p className="text-gray-500 text-xs">{user.email}</p>}
                        {(() => {
                          const est = establishments.find(e => e.id === user.establishmentId);
                          return est ? (
                            <p className="text-xs text-orange-600 flex items-center gap-1 mt-1">
                              <Store size={12} /> {est.name}
                            </p>
                          ) : (
                            <p className="text-xs text-gray-400 mt-1">Sem estabelecimento</p>
                          );
                        })()}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                        <select
                          value={user.establishmentId || ''}
                          onChange={async (e) => {
                            try {
                              await updateUser(user.id, { establishmentId: e.target.value || null });
                            } catch (err) {
                              alert('Erro ao alterar estabelecimento: ' + err.message);
                            }
                          }}
                          className="px-3 py-2 border rounded-lg text-sm bg-white"
                        >
                          <option value="">Sem estabelecimento</option>
                          {establishments.map(est => (
                            <option key={est.id} value={est.id}>{est.name}</option>
                          ))}
                        </select>

                        <button
                          onClick={() => setEditingUser(user)}
                          className="flex items-center gap-2 bg-blue-100 text-blue-700 px-4 py-2 rounded-lg hover:bg-blue-200 transition"
                        >
                          <Edit2 size={18} />
                          <span className="hidden sm:inline">Editar</span>
                        </button>
                        <button
                          onClick={() => setEditingPassword(user)}
                          className="flex items-center gap-2 bg-orange-100 text-orange-700 px-4 py-2 rounded-lg hover:bg-orange-200 transition"
                        >
                          <Key size={18} />
                          <span className="hidden sm:inline">Senha</span>
                        </button>
                        <button 
                          onClick={() => handleDeleteUser(user)} 
                          className="flex items-center gap-2 bg-red-100 text-red-700 px-4 py-2 rounded-lg hover:bg-red-200 transition"
                        >
                          <Trash2 size={18} />
                          <span className="hidden sm:inline">Excluir</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'financial' && (
          <div>
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 mb-6">
              <div>
        <h2 className="text-xl sm:text-2xl font-bold">Controle Financeiro</h2>
        <p className="text-sm sm:text-base text-gray-600 mt-1">Gerencie os pagamentos por rodada.</p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 w-full sm:w-auto mt-4 sm:mt-0">
                <div className="w-full sm:w-64">
                  <label className="block text-xs sm:text-sm font-medium mb-2">Filtrar por Estabelecimento</label>
                  <select
                    value={establishmentFilter}
                    onChange={(e) => setEstablishmentFilter(e.target.value)}
                    className="w-full px-3 sm:px-4 py-2 border rounded-lg bg-white"
                  >
                    <option value="all">Todos</option>
                    <option value="none">Sem estabelecimento</option>
                    {establishments.map(est => (
                      <option key={est.id} value={est.id}>{est.name}</option>
                    ))}
                  </select>
                </div>
                <div className="w-full sm:w-64">
                  <label className="block text-xs sm:text-sm font-medium mb-2">Selecione a Rodada</label>
                  <select
                    value={selectedFinanceRound || ''}
                    onChange={(e) => setSelectedFinanceRound(e.target.value)}
                    className="w-full px-3 sm:px-4 py-2 border rounded-lg bg-white"
                  >
                    <option value="">Todas as rodadas</option>
                    {rounds.filter(r => r.status !== 'upcoming').sort((a, b) => b.number - a.number).map(round => (
                      <option key={round.id} value={round.id}>
                        {round.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => generateFinancialReportPDF(selectedFinanceRound, establishmentFilter)}
                  className="inline-flex items-center justify-center gap-2 bg-orange-600 text-white px-3 sm:px-4 py-2 text-sm rounded-lg hover:bg-orange-700 disabled:bg-gray-200 disabled:text-gray-500 w-full sm:w-auto"
                  disabled={
                    !selectedFinanceRound ||
                    !establishmentFilter ||
                    establishmentFilter === 'all' ||
                    establishmentFilter === 'none'
                  }
                  title={
                    !selectedFinanceRound || establishmentFilter === 'all' || establishmentFilter === 'none'
                      ? 'Selecione rodada e estabelecimento específicos'
                      : 'Gerar relatório PDF'
                  }
                >
                  <Download size={18} /> Gerar PDF
                </button>
              </div>
            </div>

            {selectedFinanceRound ? (
              (() => {
                const round = rounds.find(r => r.id === selectedFinanceRound);
                let participants = getRoundParticipants(selectedFinanceRound);
                
                // Filtrar por estabelecimento
                if (establishmentFilter !== 'all') {
                  if (establishmentFilter === 'none') {
                    participants = participants.filter(p => !p.establishmentId);
                  } else {
                    participants = participants.filter(p => p.establishmentId === establishmentFilter);
                  }
                }
                
                const summary = getRoundFinancialSummary(selectedFinanceRound, establishmentFilter !== 'all' ? establishmentFilter : null, true);
                
                const filteredParticipants = participants.filter(p => {
                  if (paymentFilter === 'paid') return p.paid;
                  if (paymentFilter === 'pending') return !p.paid;
                  return true;
                });

                return (
                  <div className="space-y-6">
                    {/* Resumo Financeiro */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4">
                      <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-blue-600 text-sm font-medium">Total Esperado</p>
                            <p className="text-xl sm:text-2xl font-bold text-blue-900">R$ {summary.totalExpected.toFixed(2)}</p>
                            <p className="text-xs text-blue-600 mt-1">{summary.totalParticipations} cartelas</p>
                          </div>
                          <Users className="text-blue-400" size={28} />
                        </div>
                      </div>

                      <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-green-600 text-sm font-medium">Recebido</p>
                            <p className="text-xl sm:text-2xl font-bold text-green-900">R$ {summary.totalReceived.toFixed(2)}</p>
                            <p className="text-xs text-green-600 mt-1">{summary.paidCount} pagamentos</p>
                          </div>
                          <CheckCircle className="text-green-400" size={28} />
                        </div>
                      </div>

                      <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-yellow-600 text-sm font-medium">Premiação (85%)</p>
                            <p className="text-xl sm:text-2xl font-bold text-yellow-900">R$ {summary.prizePool.toFixed(2)}</p>
                          </div>
                          <Trophy className="text-yellow-400" size={28} />
                        </div>
                      </div>

                      <div className="bg-purple-50 border-2 border-purple-200 rounded-xl p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-purple-600 text-sm font-medium">Admin (10%)</p>
                            <p className="text-xl sm:text-2xl font-bold text-purple-900">R$ {summary.adminFee.toFixed(2)}</p>
                          </div>
                          <Award className="text-purple-400" size={28} />
                        </div>
                      </div>

                      <div className="bg-orange-50 border-2 border-orange-200 rounded-xl p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-orange-600 text-sm font-medium">Estabelec. (5%)</p>
                            <p className="text-xl sm:text-2xl font-bold text-orange-900">R$ {summary.establishmentFee.toFixed(2)}</p>
                          </div>
                          <Store className="text-orange-400" size={28} />
                        </div>
                      </div>
                    </div>

                    {/* Filtros */}
                        <div className="bg-white rounded-xl shadow-sm border p-4">
                          <div className="flex flex-col md:flex-row md:items-center md:justify-between flex-wrap gap-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-gray-700">Filtrar:</span>
                          <button
                            onClick={() => setPaymentFilter('all')}
                            className={`px-3 md:px-4 py-1.5 md:py-2 rounded-lg text-xs md:text-sm font-medium transition ${
                              paymentFilter === 'all' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                          >
                            Todos ({summary.totalParticipations})
                          </button>
                          <button
                            onClick={() => setPaymentFilter('paid')}
                            className={`px-3 md:px-4 py-1.5 md:py-2 rounded-lg text-xs md:text-sm font-medium transition ${
                              paymentFilter === 'paid' ? 'bg-green-600 text-white' : 'bg-green-100 text-green-700 hover:bg-green-200'
                            }`}
                          >
                            Pagos ({summary.paidCount})
                          </button>
                          <button
                            onClick={() => setPaymentFilter('pending')}
                            className={`px-3 md:px-4 py-1.5 md:py-2 rounded-lg text-xs md:text-sm font-medium transition ${
                              paymentFilter === 'pending' ? 'bg-red-600 text-white' : 'bg-red-100 text-red-700 hover:bg-red-200'
                            }`}
                          >
                            Pendentes ({summary.pendingCount})
                          </button>
                            </div>
                            
                            {establishmentFilter !== 'all' && establishmentFilter !== 'none' && (
                              <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 w-full md:w-auto md:ml-auto">
                                <p className="text-xs sm:text-sm text-orange-800">
                                  <Store size={14} className="inline mr-1" />
                                  <strong>Comissão deste estabelecimento:</strong> R$ {summary.establishmentFee.toFixed(2)}
                                </p>
                              </div>
                            )}
                            <div className="w-full md:w-auto md:ml-auto">
                              {(() => {
                                const pendingCount = filteredParticipants.filter(p => !p.paid).length;
                                return (
                                  <button
                                    onClick={async () => {
                                      try {
                                        setIsSendingCharges(true);
                                        const toCharge = filteredParticipants.filter(p => !p.paid);
                                        for (const p of toCharge) {
                                          await sendChargeWhatsApp(p.userId, p.cartelaCode);
                                          await new Promise(r => setTimeout(r, 300));
                                        }
                                        alert(`Cobranças iniciadas para ${toCharge.length} pendentes.`);
                                      } catch (err) {
                                        alert('Erro ao enviar cobranças: ' + err.message);
                                      } finally {
                                        setIsSendingCharges(false);
                                      }
                                    }}
                                    disabled={isSendingCharges || pendingCount === 0}
                                    className={`inline-flex items-center justify-center gap-2 px-3 md:px-4 py-2 rounded-lg text-sm font-semibold ${pendingCount === 0 ? 'bg-gray-200 text-gray-600 cursor-not-allowed' : 'bg-green-600 text-white hover:bg-green-700'} ${isSendingCharges ? 'opacity-75' : ''}`}
                                    title={pendingCount === 0 ? 'Nenhum participante pendente' : 'Cobrar todos os pendentes via WhatsApp'}
                                  >
                                    <Megaphone size={18} /> {isSendingCharges ? 'Enviando...' : `Cobrar pendentes (${pendingCount})`}
                                  </button>
                                );
                              })()}
                            </div>
                          </div>
                        </div>

                    {/* Lista de Cartelas */}
                    <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                      <div className="bg-gradient-to-r from-green-600 to-green-700 text-white p-4">
                        <h3 className="font-bold text-lg">{round?.name}</h3>
                        <p className="text-sm text-green-100 mt-1">
                          {establishmentFilter === 'all' && 'Todos os estabelecimentos'}
                          {establishmentFilter === 'none' && 'Sem estabelecimento'}
                          {establishmentFilter !== 'all' && establishmentFilter !== 'none' && 
                            `Estabelecimento: ${establishments.find(e => e.id === establishmentFilter)?.name}`
                          }
                        </p>
                      </div>
                      
                      {filteredParticipants.length === 0 ? (
                        <div className="p-12 text-center">
                          <Users className="mx-auto text-gray-400 mb-4" size={48} />
                          <h3 className="text-xl font-semibold mb-2">
                            {paymentFilter === 'paid' && 'Nenhum pagamento confirmado'}
                            {paymentFilter === 'pending' && 'Todos os pagamentos confirmados! 🎉'}
                            {paymentFilter === 'all' && 'Nenhuma participação nesta rodada'}
                          </h3>
                        </div>
                      ) : (
                        <div className="overflow-x-auto -mx-2 sm:mx-0">
                        <table className="min-w-[720px] w-full text-xs sm:text-sm">
                          <thead className="bg-gray-50 border-b">
                            <tr>
                              <th className="px-4 sm:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-medium text-gray-500 uppercase">Participante</th>
                              <th className="px-4 sm:px-6 py-3 sm:py-4 text-center text-[10px] sm:text-xs font-medium text-gray-500 uppercase">Cartela</th>
                              <th className="px-4 sm:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-medium text-gray-500 uppercase">Estabelecimento</th>
                              <th className="px-4 sm:px-6 py-3 sm:py-4 text-center text-[10px] sm:text-xs font-medium text-gray-500 uppercase">Valor</th>
                              <th className="px-4 sm:px-6 py-3 sm:py-4 text-center text-[10px] sm:text-xs font-medium text-gray-500 uppercase">Status</th>
                              <th className="px-4 sm:px-6 py-3 sm:py-4 text-center text-[10px] sm:text-xs font-medium text-gray-500 uppercase">Ação</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {filteredParticipants.map((participant) => {
                              const user = users.find(u => u.id === participant.userId);
                              const establishment = establishments.find(e => e.id === participant.establishmentId);
                              if (!user) return null;
                               
                              return (
                                <tr key={`${participant.userId}-${participant.cartelaCode}`} className={participant.paid ? 'bg-green-50' : ''}>
                                  <td className="px-4 sm:px-6 py-3 sm:py-4">
                                    <div>
                                      <span className="font-medium">{user.name}</span>
                                      <p className="text-xs text-gray-500">{user.whatsapp}</p>
                                    </div>
                                  </td>
                                  <td className="px-4 sm:px-6 py-3 sm:py-4 text-center">
                                    <span className="font-mono text-sm bg-blue-100 text-blue-700 px-2 py-1 rounded">
                                      {participant.cartelaCode}
                                    </span>
                                  </td>
                                  <td className="px-4 sm:px-6 py-3 sm:py-4">
                                    {establishment ? (
                                      <div>
                                        <p className="font-medium text-sm text-orange-600">{establishment.name}</p>
                                        <p className="text-xs text-gray-500">{establishment.contact}</p>
                                      </div>
                                    ) : (
                                      <span className="text-xs text-gray-400">Nenhum</span>
                                    )}
                                  </td>
                                  <td className="px-4 sm:px-6 py-3 sm:py-4 text-center">
                                    <span className="text-base md:text-lg font-bold text-gray-900">R$ {summary.betValue.toFixed(2)}</span>
                                  </td>
                                  <td className="px-4 sm:px-6 py-3 sm:py-4 text-center">
                                    {participant.paid ? (
                                      <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 px-3 py-1 rounded-full text-sm font-medium">
                                        <CheckCircle size={16} /> Pago
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 px-3 py-1 rounded-full text-sm font-medium">
                                        <XCircle size={16} /> Pendente
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-4 sm:px-6 py-3 sm:py-4 text-center">
                                    <button
                                      onClick={() => togglePaymentStatus(participant.userId, selectedFinanceRound, participant.cartelaCode)}
                                      className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                                        participant.paid
                                          ? 'bg-red-100 text-red-700 hover:bg-red-200'
                                          : 'bg-green-600 text-white hover:bg-green-700'
                                      }`}
                                    >
                                      {participant.paid ? 'Marcar Pendente' : 'Marcar Pago'}
                                    </button>
                                    {!participant.paid && (
                                      <button
                                        onClick={() => sendChargeWhatsApp(participant.userId, participant.cartelaCode)}
                                        className="ml-2 px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 inline-flex items-center gap-1"
                                        title="Cobrar via WhatsApp"
                                      >
                                        <Send size={16} /> Cobrar
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()
            ) : (
              (() => {
                // Visão consolidada: soma todas as rodadas (exceto futuras), respeitando o filtro de estabelecimento.
                const betValue = settings?.betValue || 15;
                const activeRounds = rounds.filter(r => r.status !== 'upcoming');
                let totalExpected = 0, totalReceived = 0, totalPending = 0;
                const byEst = {};
                const debtByUser = {};
                for (const round of activeRounds) {
                  let parts = getRoundParticipants(round.id);
                  if (establishmentFilter === 'none') parts = parts.filter(p => !p.establishmentId);
                  else if (establishmentFilter !== 'all') parts = parts.filter(p => p.establishmentId === establishmentFilter);
                  for (const p of parts) {
                    totalExpected += betValue;
                    const estKey = p.establishmentId || 'none';
                    if (!byEst[estKey]) byEst[estKey] = { expected: 0, received: 0, pending: 0, count: 0 };
                    byEst[estKey].expected += betValue; byEst[estKey].count += 1;
                    if (p.paid) { totalReceived += betValue; byEst[estKey].received += betValue; }
                    else {
                      totalPending += betValue; byEst[estKey].pending += betValue;
                      if (!debtByUser[p.userId]) debtByUser[p.userId] = { count: 0, value: 0 };
                      debtByUser[p.userId].count += 1; debtByUser[p.userId].value += betValue;
                    }
                  }
                }
                const estRows = Object.entries(byEst).map(([id, v]) => ({
                  id, name: id === 'none' ? 'Sem estabelecimento' : (establishments.find(e => e.id === id)?.name || 'Estabelecimento'), ...v
                })).sort((a, b) => b.expected - a.expected);
                const inadimplentes = Object.entries(debtByUser).map(([uid, d]) => ({
                  user: users.find(u => u.id === uid), userId: uid, ...d
                })).filter(x => x.user).sort((a, b) => b.value - a.value);
                const pct = totalExpected > 0 ? Math.round((totalReceived / totalExpected) * 100) : 0;

                const chargeLink = (u, d) => {
                  const digits = String(u.whatsapp || '').replace(/\D/g, '');
                  const num = digits.startsWith('55') ? digits : '55' + digits;
                  const msg = `Olá ${u.name || ''}! Você tem ${d.count} cartela(s) com pagamento pendente no bolão, totalizando R$ ${d.value.toFixed(2).replace('.', ',')}. Regularize para validar seus pontos. Obrigado!`;
                  return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
                };

                return (
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                      <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
                        <p className="text-blue-600 text-sm font-medium">Total Esperado</p>
                        <p className="text-xl sm:text-2xl font-bold text-blue-900">R$ {totalExpected.toFixed(2)}</p>
                        <p className="text-xs text-blue-600 mt-1">{activeRounds.length} rodadas</p>
                      </div>
                      <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4">
                        <p className="text-green-600 text-sm font-medium">Recebido</p>
                        <p className="text-xl sm:text-2xl font-bold text-green-900">R$ {totalReceived.toFixed(2)}</p>
                        <p className="text-xs text-green-600 mt-1">{pct}% do esperado</p>
                      </div>
                      <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4">
                        <p className="text-red-600 text-sm font-medium">Pendente</p>
                        <p className="text-xl sm:text-2xl font-bold text-red-900">R$ {totalPending.toFixed(2)}</p>
                        <p className="text-xs text-red-600 mt-1">{inadimplentes.length} inadimplentes</p>
                      </div>
                      <div className="bg-purple-50 border-2 border-purple-200 rounded-xl p-4">
                        <p className="text-purple-600 text-sm font-medium">Admin (10%)</p>
                        <p className="text-xl sm:text-2xl font-bold text-purple-900">R$ {(totalReceived * 0.10).toFixed(2)}</p>
                      </div>
                    </div>

                    <div className="bg-white rounded-xl border p-5">
                      <h3 className="font-semibold mb-3 flex items-center gap-2"><Store size={18} /> Por estabelecimento</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-gray-500 border-b">
                              <th className="py-2 pr-4">Estabelecimento</th>
                              <th className="py-2 px-2 text-right">Esperado</th>
                              <th className="py-2 px-2 text-right">Recebido</th>
                              <th className="py-2 pl-2 text-right">Pendente</th>
                            </tr>
                          </thead>
                          <tbody>
                            {estRows.length === 0 && (
                              <tr><td colSpan="4" className="py-4 text-center text-gray-400">Sem dados.</td></tr>
                            )}
                            {estRows.map(r => (
                              <tr key={r.id} className="border-b last:border-0">
                                <td className="py-2 pr-4">{r.name}</td>
                                <td className="py-2 px-2 text-right">R$ {r.expected.toFixed(2)}</td>
                                <td className="py-2 px-2 text-right text-green-700">R$ {r.received.toFixed(2)}</td>
                                <td className="py-2 pl-2 text-right text-red-700">R$ {r.pending.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="bg-white rounded-xl border p-5">
                      <h3 className="font-semibold mb-3 flex items-center gap-2"><AlertCircle size={18} className="text-red-500" /> Inadimplentes ({inadimplentes.length})</h3>
                      {inadimplentes.length === 0 ? (
                        <p className="text-gray-400 text-sm py-2">Nenhum pagamento pendente. Tudo em dia.</p>
                      ) : (
                        <div className="divide-y">
                          {inadimplentes.map(x => (
                            <div key={x.userId} className="flex items-center justify-between py-2.5 gap-3">
                              <div className="min-w-0">
                                <p className="font-medium truncate">{x.user.name}</p>
                                <p className="text-xs text-gray-500">{x.count} cartela(s) • R$ {x.value.toFixed(2).replace('.', ',')}</p>
                              </div>
                              {x.user.whatsapp && (
                                <a href={chargeLink(x.user, x)} target="_blank" rel="noopener noreferrer"
                                  className="flex items-center gap-1.5 bg-green-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-green-700 whitespace-nowrap">
                                  <Send size={15} /> Cobrar
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()
            )}
          </div>
        )}

        {activeTab === 'communications' && (
          <div>
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
              <div>
                <h2 className="text-2xl font-bold">Comunicados</h2>
                <p className="text-gray-600 mt-1">Envie mensagens aos participantes e acompanhe o histórico.</p>
              </div>
            </div>

            {/* Sub-abas dentro de Comunicados */}
            <div role="tablist" aria-label="Seções de Comunicados" className="flex gap-3 border-b mb-6">
              <button
                role="tab"
                aria-selected={commActiveTab === 'envio'}
                onClick={() => setCommActiveTab('envio')}
                className={`py-3 px-2 border-b-2 font-medium ${commActiveTab === 'envio' ? 'border-green-600 text-green-600' : 'border-transparent text-gray-500'}`}
              >
                <Megaphone className="inline mr-2" size={18} />Envio
              </button>
              <button
                role="tab"
                aria-selected={commActiveTab === 'historico'}
                onClick={() => setCommActiveTab('historico')}
                className={`py-3 px-2 border-b-2 font-medium ${commActiveTab === 'historico' ? 'border-green-600 text-green-600' : 'border-transparent text-gray-500'}`}
              >
                <Calendar className="inline mr-2" size={18} />Histórico
              </button>
            </div>

            {commActiveTab === 'envio' && (
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                  <Megaphone size={22} className="text-green-600" />
                  Enviar comunicado
                </h3>
                <div className="space-y-4">
                  {/* Filtros de destinatários por rodada e pagamento */}
                  <fieldset className="border rounded-lg p-3">
                    <legend className="text-sm font-semibold text-gray-700">Destinatários</legend>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                    <div>
                      <label className="block text-sm font-medium mb-2">Rodada</label>
                      <select
                        value={selectedCommRound || ''}
                        onChange={(e) => setSelectedCommRound(e.target.value || null)}
                        className="w-full border rounded-lg p-2 text-sm"
                      >
                        <option value="">Selecione uma rodada</option>
                        {rounds.map(r => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                      {!selectedCommRound && !selectAllCommUsers && (
                        <p id="err-comm-round" className="text-xs text-red-600 mt-1">Selecione uma rodada.</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Filtro de pagamento</label>
                      <select
                        value={commPaymentFilter}
                        onChange={(e) => setCommPaymentFilter(e.target.value)}
                        className="w-full border rounded-lg p-2 text-sm"
                      >
                        <option value="all">Todos</option>
                        <option value="paid">Apenas pagos</option>
                        <option value="pending">Apenas pendentes</option>
                      </select>
                    </div>
                    <div className="mt-3">
                      <div className="flex items-center justify-between">
                        <label className="block text-sm font-medium mb-2">Destinatário</label>
                        <label className="flex items-center gap-2 text-xs">
                          <input
                            ref={selectAllCommRef}
                            type="checkbox"
                            className="w-4 h-4"
                            checked={selectAllCommUsers}
                            onChange={(e)=>handleToggleSelectAllComm(e.target.checked)}
                            aria-label="Selecionar todos os usuários"
                            aria-checked={selectAllCommUsers && commSelectedUserIds.length > 0 && commSelectedUserIds.length < (users.filter(u => !u.isAdmin && !!u.whatsapp).length) ? 'mixed' : selectAllCommUsers}
                          />
                          Selecionar todos os usuários
                        </label>
                      </div>
                      <select
                        value={selectedCommUserId}
                        onChange={(e) => setSelectedCommUserId(e.target.value)}
                        disabled={selectAllCommUsers}
                        className={`w-full border rounded-lg p-2 text-sm ${selectAllCommUsers ? 'bg-gray-100 text-gray-600 cursor-not-allowed' : ''}`}
                        aria-invalid={!selectAllCommUsers && !selectedCommUserId}
                        aria-describedby={!selectAllCommUsers && !selectedCommUserId ? 'err-comm-user' : undefined}
                      >
                        <option value="">Selecione um participante</option>
                        {users.filter(u => !u.isAdmin).map(u => (
                          <option key={u.id} value={u.id}>{u.name} {u.whatsapp ? `• ${u.whatsapp}` : '• sem WhatsApp'}</option>
                        ))}
                      </select>
                      {!selectAllCommUsers && !selectedCommUserId && (
                        <p id="err-comm-user" className="text-xs text-red-600 mt-1">Selecione um participante ou marque "Selecionar todos".</p>
                      )}
                      {selectAllCommUsers && (() => {
                        const eligible = users.filter(u => !u.isAdmin && !!u.whatsapp);
                        return (
                          <div className="mt-2">
                            <p className="text-xs text-gray-600" aria-live="polite">Selecionados: {commSelectedUserIds.length} de {eligible.length}</p>
                            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                              {eligible.map(u => {
                                const checked = commSelectedUserIds.includes(u.id);
                                return (
                                  <label
                                    key={u.id}
                                    htmlFor={`comm-user-${u.id}`}
                                    className={`flex items-center gap-2 p-2 border rounded-lg cursor-pointer transition-colors ${checked ? 'bg-green-50 border-green-400 ring-1 ring-green-300' : 'hover:bg-gray-50'}`}
                                  >
                                    <input
                                      id={`comm-user-${u.id}`}
                                      type="checkbox"
                                      className="w-4 h-4"
                                      checked={checked}
                                      onChange={(e) => toggleCommUser(u.id, e.target.checked)}
                                      aria-label={`Selecionar ${u.name}`}
                                    />
                                    <span className="text-sm">{u.name} {u.whatsapp ? `• ${u.whatsapp}` : '• sem WhatsApp'}</span>
                                  </label>
                                );
                              })}
                            </div>
                            {commSelectedUserIds.length === 0 && (
                              <p className="text-xs text-red-600 mt-1">Selecione ao menos um participante.</p>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                    </div>
                  </fieldset>

                  

                  <div>
                    <label className="block text-sm font-medium mb-2">Mensagem</label>
                    <textarea
                      value={commsMessage}
                      onChange={(e) => setCommsMessage(e.target.value)}
                      rows={6}
                      placeholder="Use {NOME} para inserir o nome do destinatário"
                      className="w-full border rounded-lg p-2 font-mono text-sm"
                      aria-invalid={!commsMessage}
                      aria-describedby={!commsMessage ? 'err-comm-msg' : undefined}
                    />
                    {!commsMessage && (
                      <p id="err-comm-msg" className="text-xs text-red-600 mt-1">Informe uma mensagem.</p>
                    )}
                    <p className="text-xs text-gray-500 mt-2">Variáveis: {'{NOME}'} • Dica: personalize com contexto curto.</p>

                    {(() => {
                      const context = getTemplateContext();
                      const { unknownTags, missingTags } = validateMessageTags(commsMessage || '', context);
                      const hasIssues = (unknownTags.length + missingTags.length) > 0;
                      if (!hasIssues) return null;
                      return (
                        <div className="mt-2 p-2 border rounded-lg bg-yellow-50 text-yellow-800 text-xs">
                          {unknownTags.length > 0 && (
                            <p><strong>Tags desconhecidas:</strong> {unknownTags.join(', ')}</p>
                          )}
                          {missingTags.length > 0 && (
                            <p><strong>Tags sem valor no contexto:</strong> {missingTags.join(', ')}</p>
                          )}
                          <div className="mt-2">
                            <button
                              onClick={() => setCommsMessage(normalizeTags(commsMessage || ''))}
                              className="px-3 py-1 rounded bg-yellow-600 text-white hover:bg-yellow-700"
                            >Corrigir tags</button>
                          </div>
                        </div>
                      );
                    })()}

                  </div>

                  {/* Personalização rápida para modelos */}
                  <div className="bg-gray-50 border rounded-lg p-3">
                    <p className="text-sm font-medium mb-2">Personalização rápida</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium mb-1">Prazo final (fechamento programado)</label>
                        <input type="text" value={commDeadline} readOnly disabled placeholder="Selecionar uma rodada" className="w-full border rounded-lg p-2 text-sm bg-gray-100 text-gray-700" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Data divulgação (criação da rodada)</label>
                        <input type="text" value={commResultsDate} readOnly disabled placeholder="Selecionar uma rodada" className="w-full border rounded-lg p-2 text-sm bg-gray-100 text-gray-700" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Link do sistema</label>
                        <input type="text" value={commAppLink} onChange={(e)=>setCommAppLink(e.target.value)} placeholder="https://seusistema.com" className="w-full border rounded-lg p-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Link do ranking (gerado automaticamente)</label>
                        <input type="text" value={commPdfUrl} readOnly disabled placeholder="Selecionar uma rodada" className="w-full border rounded-lg p-2 text-sm bg-gray-100 text-gray-700" />
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    {(() => {
                      const recipients = getCommRecipients();
                      const disabled = selectAllCommUsers ? (recipients.length === 0 || !commsMessage || isSendingMassComms) : (!selectedCommUserId || !commsMessage || isSendingSingleComm);
                      const handleClick = () => selectAllCommUsers ? sendMassCommunications() : sendGeneralCommunication();
                      return (
                        <>
                          <button
                            onClick={handleClick}
                            disabled={disabled}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold ${disabled ? 'bg-gray-200 text-gray-600 cursor-not-allowed' : 'bg-green-600 text-white hover:bg-green-700'}`}
                          >
                            {(isSendingMassComms && selectAllCommUsers) || (isSendingSingleComm && !selectAllCommUsers) ? (<Loader2 size={18} className="animate-spin" />) : (<Send size={18} />)}
                            Enviar Mensagem
                          </button>
                          <button
                            onClick={async () => {
                              if (!commsMessage) { setCommFeedback({ type: 'error', text: 'Digite uma mensagem.' }); setTimeout(() => setCommFeedback(null), 3000); return; }
                              setIsSendingGroupComm(true);
                              try {
                                await sendTextToGroup(commsMessage);
                                setCommFeedback({ type: 'success', text: '✅ Mensagem enviada ao grupo!' });
                                setTimeout(() => setCommFeedback(null), 3000);
                              } catch (err) {
                                setCommFeedback({ type: 'error', text: 'Erro ao enviar ao grupo: ' + err.message });
                                setTimeout(() => setCommFeedback(null), 5000);
                              } finally {
                                setIsSendingGroupComm(false);
                              }
                            }}
                            disabled={!commsMessage || isSendingGroupComm}
                            title={`Enviar para o grupo: ${(settings?.whatsapp?.groupJid || whatsappGroupJid || 'não configurado')}`}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border-2 ${!commsMessage || isSendingGroupComm ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' : 'bg-white text-green-700 border-green-600 hover:bg-green-50'}`}
                          >
                            {isSendingGroupComm ? (<Loader2 size={18} className="animate-spin" />) : (<Users size={18} />)}
                            Enviar ao Grupo
                          </button>
                          <span className="text-xs text-gray-500">{selectAllCommUsers ? `Todos os elegíveis (${recipients.length}) via EvolutionAPI.` : 'Envia via EvolutionAPI e registra no histórico.'}</span>
                          {commFeedback?.text && (
                            <span role="status" aria-live="polite" className={`text-xs ${commFeedback?.type === 'error' ? 'text-red-600' : 'text-green-600'} ml-2`}>
                              {commFeedback.text}
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </div>

                  {/* Envio em massa conforme filtros */}
                  <div className="mt-2 p-3 bg-gray-50 border rounded-lg">
                    {(() => {
                      const recipients = getCommRecipients();
                      const count = recipients.length;
                      return (
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                          <p className="text-xs sm:text-sm text-gray-700">
                            Destinatários filtrados: <strong>{count}</strong> {selectedCommRound ? `• ${rounds.find(r => r.id === selectedCommRound)?.name}` : ''}
                          </p>
                          <button
                            onClick={sendMassCommunications}
                            disabled={count === 0 || !commsMessage || isSendingMassComms}
                            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold ${count === 0 || !commsMessage || isSendingMassComms ? 'bg-gray-200 text-gray-600 cursor-not-allowed' : 'bg-green-700 text-white hover:bg-green-800'}`}
                          >
                            {isSendingMassComms ? (<Loader2 size={18} className="animate-spin" />) : (<Send size={18} />)}
                            Enviar para filtrados{count ? ` (${count})` : ''}
                          </button>
                        </div>
                      );
                    })()}
                    <p className="text-[11px] text-gray-500 mt-2">Valida WhatsApp e registra cada envio com status.</p>
                  </div>

                  {/* Modelos (seleção rápida + pré-configurados) */}

                  {/* Modelos: dropdown categorizado com preview e ações */}
                  <div className="mt-4">
                    <div className="bg-gradient-to-r from-green-600 to-green-700 text-white p-3 rounded-t-lg">
                      <h4 className="font-semibold text-sm">Modelos • {settings?.brandName || 'Bolão Brasileiro 2026'}</h4>
                    </div>
                    <div className="border rounded-b-lg p-3 bg-white">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                        <div>
                          <label className="block text-xs font-medium mb-2">Seleção de modelo</label>
                          <select
                            value={commSelectedTemplateKey}
                            onChange={(e) => {
                              const key = e.target.value;
                              setCommSelectedTemplateKey(key);
                              if (key) {
                                const text = buildTemplateText(key, 'rich');
                                setCommsMessage(text);
                              }
                            }}
                            className="w-full border rounded-lg p-2 text-sm"
                          >
                            <option value="">Selecione um modelo</option>
                            {TEMPLATE_CATEGORIES.map(cat => (
                              <optgroup key={cat.label} label={cat.label}>
                                {cat.items.map(item => {
                                  const plainPreview = buildTemplateText(item.key, 'plain');
                                  const isFinal = item.key === 'final-result';
                                  const round = selectedCommRound ? rounds.find(r => r.id === selectedCommRound) : null;
                                  const disabled = isFinal && (!round || round.status !== 'finished');
                                  return (
                                    <option key={item.key} value={item.key} title={plainPreview.slice(0, 120)} disabled={disabled}>
                                      {item.label}{disabled ? ' (indisponível)' : ''}
                                    </option>
                                  );
                                })}
                              </optgroup>
                            ))}
                          </select>
                          <p className="text-[11px] text-gray-500 mt-1">Passe o mouse nas opções para ver a prévia curta.</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { if (commSelectedTemplateKey) applyTemplate(commSelectedTemplateKey, 'rich'); }}
                            disabled={!commSelectedTemplateKey}
                            className={`px-3 py-2 rounded-lg text-xs inline-flex items-center gap-1 ${commSelectedTemplateKey ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-gray-200 text-gray-600 cursor-not-allowed'}`}
                          >
                            <Send size={14}/> Inserir
                          </button>
                          <button
                            onClick={() => { if (commSelectedTemplateKey) copyTemplate(commSelectedTemplateKey, 'plain'); }}
                            disabled={!commSelectedTemplateKey}
                            className={`px-3 py-2 rounded-lg text-xs inline-flex items-center gap-1 ${commSelectedTemplateKey ? 'bg-gray-100 text-gray-800 hover:bg-gray-200' : 'bg-gray-200 text-gray-500 cursor-not-allowed'}`}
                          >
                            <Copy size={14}/> Copiar texto puro
                          </button>
                        </div>
                      </div>
                      {commSelectedTemplateKey && (
                        <div className="mt-3">
                          <p className="text-xs font-medium text-gray-700 mb-1">Prévia do modelo selecionado</p>
                          <pre className="whitespace-pre-wrap font-mono text-xs border rounded-lg p-3 bg-gray-50 text-gray-800">{buildTemplateText(commSelectedTemplateKey, 'rich')}</pre>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {commActiveTab === 'historico' && (
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                  <Calendar size={22} className="text-green-600" />
                  Histórico de comunicados
                </h3>
                {communications && communications.length > 0 ? (
                  <div className="overflow-x-auto overflow-y-auto max-h-[28rem]">
                    <table className="min-w-[540px] w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="px-4 py-2 text-left">Data</th>
                          <th className="px-4 py-2 text-left">Tipo</th>
                          <th className="px-4 py-2 text-left">Participante</th>
                          <th className="px-4 py-2 text-left">Canal</th>
                          <th className="px-4 py-2 text-left">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {communications.slice().reverse().map((c) => {
                          const u = users.find(x => x.id === c.userId);
                          const ts = c.createdAt && c.createdAt.seconds ? new Date(c.createdAt.seconds * 1000) : null;
                          const dateStr = ts ? ts.toLocaleString('pt-BR') : '-';
                          return (
                            <tr key={c.id} className="border-t">
                              <td className="px-4 py-2">{dateStr}</td>
                              <td className="px-4 py-2">{c.type}</td>
                              <td className="px-4 py-2">{u ? u.name : c.userId || '-'}</td>
                              <td className="px-4 py-2">{c.channel || '-'}</td>
                              <td className="px-4 py-2">{c.status || '-'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-8 text-center border-2 border-dashed rounded-lg">
                    <Megaphone className="mx-auto text-gray-400 mb-4" size={36} />
                    <p className="text-gray-600">Nenhum comunicado registrado ainda</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        </>
        )}
        </div>
      </div>{/* end main area */}

      {showRoundForm && <RoundForm round={editingRound} teams={teams} rounds={rounds} onSave={saveRound} onCancel={() => { setEditingRound(null); setShowRoundForm(false); }} />}
      {showTeamForm && <TeamForm team={editingTeam} onSave={saveTeam} onCancel={() => { setEditingTeam(null); setShowTeamForm(false); }} />}
      {showEstablishmentForm && <EstablishmentForm establishment={editingEstablishment} onSave={saveEstablishment} onCancel={() => { setEditingEstablishment(null); setShowEstablishmentForm(false); }} />}
      {editingPassword && <PasswordModal user={editingPassword} onSave={savePassword} onCancel={() => setEditingPassword(null)} />}
      {editingUser && <UserEditModal user={editingUser} onSave={saveUser} onCancel={() => setEditingUser(null)} />}

      {adminPlayerModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={() => setAdminPlayerModal(null)}>
          <div className="bg-white w-[95%] max-w-3xl rounded-xl shadow-xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b flex-shrink-0">
              <div>
                <h3 className="text-lg font-bold">Palpites do Participante</h3>
                <p className="text-sm text-gray-500">{adminPlayerModal.round?.name}</p>
              </div>
              <button className="p-2 rounded hover:bg-gray-100" onClick={() => setAdminPlayerModal(null)} aria-label="Fechar">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <p className="font-medium text-gray-900">{adminPlayerModal.item?.user?.name}</p>
                  <p className="text-xs text-gray-500">{adminPlayerModal.item?.user?.whatsapp}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm bg-blue-100 text-blue-700 px-2 py-1 rounded">{adminPlayerModal.cartela?.code}</span>
                  {(() => {
                    const data = getRoundDashboardData(adminPlayerModal.round.id);
                    const isWinner = data?.winners?.some(w => w.user.id === adminPlayerModal.item.user.id && w.cartelaCode === adminPlayerModal.item.cartelaCode);
                    return isWinner ? (
                      <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 px-3 py-1 rounded-full text-sm font-medium">
                        <Award size={16} /> Campeão — R$ {data?.prizePerWinner?.toFixed(2)}
                      </span>
                    ) : null;
                  })()}
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg border overflow-x-auto">
                <table className="min-w-[420px] w-full text-xs sm:text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Jogo</th>
                      <th className="px-3 py-2 text-center font-medium text-gray-600">Palpite</th>
                      <th className="px-3 py-2 text-center font-medium text-gray-600">Placar Final</th>
                      <th className="px-3 py-2 text-center font-medium text-gray-600">Pts</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {[...(adminPlayerModal.round?.matches || [])].sort(sortMatchesByDate).map((match) => {
                      const pred = adminPlayerModal.cartela?.predictions?.find(p => p.matchId === match.id);
                      if (!pred) return null;
                      const homeTeam = teams.find(t => t.id === match.homeTeamId) || teams.find(t => t.name === match.homeTeam);
                      const awayTeam = teams.find(t => t.id === match.awayTeamId) || teams.find(t => t.name === match.awayTeam);
                      let pts = 0;
                      if (isMatchEffectivelyFinished(match) && match.homeScore !== null && match.awayScore !== null) {
                        if (pred.homeScore === match.homeScore && pred.awayScore === match.awayScore) {
                          pts = 3;
                        } else {
                          const predRes = pred.homeScore > pred.awayScore ? 'home' : pred.homeScore < pred.awayScore ? 'away' : 'draw';
                          const matchRes = match.homeScore > match.awayScore ? 'home' : match.homeScore < match.awayScore ? 'away' : 'draw';
                          if (predRes === matchRes) pts = 1;
                        }
                      }
                      return (
                        <tr key={match.id}>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <img src={getSafeLogo(homeTeam || { name: match.homeTeam })} alt={homeTeam?.name || match.homeTeam} className="w-6 h-6 object-contain rounded bg-white ring-1 ring-gray-200 flex-shrink-0" width={24} height={24} />
                              <span className="text-gray-900">{homeTeam?.name || match.homeTeam}</span>
                              <span className="text-gray-400">vs</span>
                              <img src={getSafeLogo(awayTeam || { name: match.awayTeam })} alt={awayTeam?.name || match.awayTeam} className="w-6 h-6 object-contain rounded bg-white ring-1 ring-gray-200 flex-shrink-0" width={24} height={24} />
                              <span className="text-gray-900">{awayTeam?.name || match.awayTeam}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-center font-mono">{pred.homeScore} x {pred.awayScore}</td>
                          <td className="px-3 py-2 text-center font-mono">{isMatchEffectivelyFinished(match) ? `${match.homeScore} x ${match.awayScore}` : '-'}</td>
                          <td className="px-3 py-2 text-center font-semibold">{pts}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


export default AdminPanel;
