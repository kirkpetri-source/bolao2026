import React, { useState, useEffect, useMemo } from 'react';
import { Loader2, ArrowLeft, LogIn, UserPlus } from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase.js';
import { loginWithWhatsapp, adminCreateUser, authErrorMessage } from './authService.js';
import { rememberTenant } from './tenant.js';
import { Marca } from './components/Marca.jsx';
import { CampoSenha } from './components/CampoSenha.jsx';
import { EsqueciSenhaModal } from './components/EsqueciSenha.jsx';
import { validaSenha, MIN_SENHA } from '../api/_shared/senha.js';

// A ÚNICA tela de entrada do sistema, em /entrar.
//
// Antes existiam duas: esta e uma por bolão, aberta pelo link do organizador
// (/nome-do-bolao). Eram telas diferentes em layout, tipografia e até logotipo,
// e o participante via uma ou outra dependendo de como tinha chegado. Agora o
// endereço do bolão redireciona para cá, e o bolão vem no parâmetro `?bolao=`.
//
// Como o login não precisa saber o bolão (a conta já nasce vinculada a um, e o
// sistema leva a pessoa para lá), o único momento em que o bolão importa é o
// CADASTRO — e aí ele é escolhido numa lista suspensa, pré-selecionada quando
// a pessoa chegou por um convite.

const formataTelefone = (digitos) => {
  const d = String(digitos || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

const paramsDaUrl = () => {
  try { return new URLSearchParams(window.location.search); }
  catch { return new URLSearchParams(); }
};

export default function Entrada() {
  const params = useMemo(paramsDaUrl, []);
  const bolaoDoConvite = (params.get('bolao') || '').toLowerCase();

  // 'entrar' | 'cadastrar'. Quem chega por convite com ?cadastro=1 já cai no
  // formulário de cadastro — foi convidado para participar, não para logar.
  const [modo, setModo] = useState(params.get('cadastro') === '1' ? 'cadastrar' : 'entrar');

  const [whatsapp, setWhatsapp] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [entrando, setEntrando] = useState(false);
  const [esqueci, setEsqueci] = useState(false);

  // Cadastro
  const [nome, setNome] = useState('');
  const [confirma, setConfirma] = useState('');
  const [bolao, setBolao] = useState(bolaoDoConvite);
  const [pontoDeVenda, setPontoDeVenda] = useState('');
  const [pontos, setPontos] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const [pronto, setPronto] = useState(false);

  const [boloes, setBoloes] = useState(null);

  // A lista carrega já na abertura: ela é a lista suspensa do cadastro. O
  // ?slug= garante que um bolão fechado (fora da lista pública) apareça para
  // quem chegou pelo convite dele.
  useEffect(() => {
    let cancelado = false;
    const url = bolaoDoConvite
      ? `/api/tenants/list?slug=${encodeURIComponent(bolaoDoConvite)}`
      : '/api/tenants/list';
    fetch(url)
      .then(r => r.json())
      .then(d => { if (!cancelado) setBoloes(d.boloes || []); })
      .catch(() => { if (!cancelado) setBoloes([]); });
    return () => { cancelado = true; };
  }, [bolaoDoConvite]);

  // Pontos de venda são por bolão: só fazem sentido depois que a pessoa
  // escolhe onde vai jogar. Leitura pública, permitida pelas regras.
  useEffect(() => {
    if (!bolao) { setPontos([]); return; }
    let cancelado = false;
    getDocs(query(collection(db, 'establishments'), where('tenantId', '==', bolao)))
      .then(snap => {
        if (cancelado) return;
        setPontos(snap.docs.map(d => ({ id: d.id, name: d.data().name || 'Ponto de venda' })));
      })
      .catch(() => { if (!cancelado) setPontos([]); });
    return () => { cancelado = true; };
  }, [bolao]);

  const nomeDoBolao = useMemo(
    () => (boloes || []).find(b => b.slug === bolao)?.nome || '',
    [boloes, bolao]
  );

  const entrar = async () => {
    const numero = whatsapp.replace(/\D/g, '');
    if (numero.length < 10) { setErro('Digite seu número com DDD. Exemplo: (64) 99999-8888'); return; }
    if (!senha) { setErro('Digite a sua senha.'); return; }

    setErro(''); setEntrando(true);
    try {
      // Não escolhemos bolão aqui: o observador de autenticação leva a pessoa
      // ao bolão em que ela está cadastrada.
      await loginWithWhatsapp(numero, senha);
    } catch {
      setErro('Número ou senha não conferem. Confira e tente de novo — ou toque em "Esqueci minha senha".');
    } finally {
      setEntrando(false);
    }
  };

  const cadastrar = async () => {
    const numero = whatsapp.replace(/\D/g, '');
    if (!bolao) { setErro('Escolha o bolão em que você vai jogar.'); return; }
    if (!nome.trim()) { setErro('Digite o seu nome.'); return; }
    if (numero.length < 10) { setErro('Digite seu número com DDD. Exemplo: (64) 99999-8888'); return; }
    if (senha !== confirma) { setErro('As duas senhas estão diferentes.'); return; }
    const checagem = validaSenha(senha, { whatsapp: numero, nome });
    if (!checagem.ok) { setErro(checagem.erro); return; }

    setErro(''); setSalvando(true);
    try {
      await adminCreateUser({
        whatsapp: numero,
        password: senha,
        tenantId: bolao,
        userDoc: {
          name: nome.trim(),
          whatsapp: numero,
          isAdmin: false,
          balance: 0,
          establishmentId: pontoDeVenda || null,
          lastTenantId: bolao,
        },
      });
      rememberTenant(bolao);
      setPronto(true);
    } catch (e) {
      // Erro mais comum aqui: número já cadastrado. A mensagem tem de dizer o
      // que fazer, e não só que falhou.
      const msg = String(e?.code || '') === 'auth/email-already-in-use'
        ? 'Este WhatsApp já tem cadastro. Volte e use "Entrar" — se não lembrar a senha, use "Esqueci minha senha".'
        : authErrorMessage(e);
      setErro(msg);
    } finally {
      setSalvando(false);
    }
  };

  const Cabecalho = () => (
    <div className="flex justify-center mb-8">
      <a href="/" aria-label="Página inicial"><Marca tamanho="grande" idSufixo="-entrada" /></a>
    </div>
  );

  const Erro = () => erro ? (
    <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 px-4 py-3 rounded-xl text-sm mb-4">
      {erro}
    </div>
  ) : null;

  // ── Cadastro concluído ──────────────────────────────────────────────────
  if (pronto) {
    return (
      <div className="min-h-screen page-bg font-body flex items-center justify-center p-5">
        <div className="w-full max-w-md">
          <Cabecalho />
          <div className="bg-white rounded-2xl border shadow-modal p-7 text-center">
            <div className="w-14 h-14 rounded-full bg-campo-100 dark:bg-campo-600/20 flex items-center justify-center mx-auto mb-4">
              <UserPlus className="text-campo-600 dark:text-campo-300" size={26} />
            </div>
            <h1 className="font-display text-2xl text-noite-900 mb-2" style={{ letterSpacing: '0.03em' }}>
              CADASTRO FEITO!
            </h1>
            <p className="text-sm text-noite-500 leading-relaxed mb-6">
              Sua conta foi criada{nomeDoBolao ? <> no <strong className="text-noite-800">{nomeDoBolao}</strong></> : ''}.
              Agora é só entrar com o seu WhatsApp e a senha que você acabou de criar.
            </p>
            <button
              onClick={() => { setPronto(false); setModo('entrar'); setSenha(''); setConfirma(''); setErro(''); }}
              className="v2-btn-primary w-full py-4 text-base">
              <LogIn size={18} /> Entrar agora
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Cadastro ────────────────────────────────────────────────────────────
  if (modo === 'cadastrar') {
    return (
      <div className="min-h-screen page-bg font-body flex items-center justify-center p-5">
        <div className="w-full max-w-md">
          <Cabecalho />
          <div className="bg-white rounded-2xl border shadow-modal p-7">
            <button onClick={() => { setModo('entrar'); setErro(''); }}
              className="inline-flex items-center gap-1.5 text-sm text-noite-500 hover:text-noite-800 mb-5">
              <ArrowLeft size={16} /> Voltar
            </button>

            <h1 className="font-display text-2xl text-noite-900 mb-2" style={{ letterSpacing: '0.03em' }}>
              CRIAR MINHA CONTA
            </h1>
            <p className="text-sm text-noite-500 mb-6">
              Preencha os dados abaixo para começar a palpitar.
            </p>

            <Erro />

            <div className="space-y-4">
              <div>
                <label htmlFor="cad-bolao" className="v2-label">Em qual bolão você vai jogar?</label>
                <select id="cad-bolao" value={bolao} onChange={(e) => setBolao(e.target.value)}
                  className="v2-input text-lg">
                  <option value="">Escolha o seu bolão</option>
                  {(boloes || []).map(b => (
                    <option key={b.slug} value={b.slug}>{b.nome}</option>
                  ))}
                </select>
                {boloes === null && (
                  <p className="text-xs text-noite-400 mt-1 flex items-center gap-1.5">
                    <Loader2 size={12} className="animate-spin" /> Carregando os bolões...
                  </p>
                )}
                {bolaoDoConvite && bolao === bolaoDoConvite && (
                  <p className="text-xs text-campo-700 dark:text-campo-300 mt-1">
                    Já selecionamos o bolão do convite que você recebeu.
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="cad-nome" className="v2-label">Seu nome</label>
                <input id="cad-nome" type="text" value={nome} onChange={(e) => setNome(e.target.value)}
                  placeholder="Como você quer aparecer no ranking"
                  autoComplete="name" className="v2-input text-lg" />
              </div>

              <div>
                <label htmlFor="cad-whatsapp" className="v2-label">Seu WhatsApp</label>
                <input id="cad-whatsapp" type="tel" inputMode="numeric"
                  value={formataTelefone(whatsapp)}
                  onChange={(e) => setWhatsapp(e.target.value.replace(/\D/g, ''))}
                  placeholder="(64) 99999-8888"
                  autoComplete="username" className="v2-input text-lg" />
                <p className="text-xs text-noite-400 mt-1">É com ele que você vai entrar no sistema.</p>
              </div>

              <CampoSenha rotulo="Crie uma senha" valor={senha} onChange={setSenha} medidor
                autoComplete="new-password" className="v2-input text-lg"
                placeholder={`Mínimo ${MIN_SENHA} caracteres`} />

              <CampoSenha rotulo="Repita a senha" valor={confirma} onChange={setConfirma}
                autoComplete="new-password" className="v2-input text-lg"
                onEnter={cadastrar} placeholder="Digite a senha de novo" />

              {pontos.length > 0 && (
                <div>
                  <label htmlFor="cad-ponto" className="v2-label">Quem te indicou? (opcional)</label>
                  <select id="cad-ponto" value={pontoDeVenda} onChange={(e) => setPontoDeVenda(e.target.value)}
                    className="v2-input text-lg">
                    <option value="">Ninguém / não sei</option>
                    {pontos.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}

              <button onClick={cadastrar} disabled={salvando}
                className="v2-btn-primary w-full py-4 text-base disabled:opacity-60">
                {salvando ? <><Loader2 size={18} className="animate-spin" /> Criando...</> : <><UserPlus size={18} /> Criar minha conta</>}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Login ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen page-bg font-body flex items-center justify-center p-5">
      <div className="w-full max-w-md">
        <Cabecalho />

        <div className="bg-white rounded-2xl border shadow-modal p-7">
          <h1 className="font-display text-2xl text-noite-900 mb-2" style={{ letterSpacing: '0.03em' }}>
            ENTRAR NO SEU BOLÃO
          </h1>
          <p className="text-sm text-noite-500 mb-6">
            Use o WhatsApp e a senha que você cadastrou. Nós te levamos direto ao seu bolão.
          </p>

          <Erro />

          <div className="space-y-4">
            <div>
              <label htmlFor="entrada-whatsapp" className="v2-label">Seu WhatsApp</label>
              <input id="entrada-whatsapp" type="tel" inputMode="numeric"
                value={formataTelefone(whatsapp)}
                onChange={(e) => setWhatsapp(e.target.value.replace(/\D/g, ''))}
                placeholder="(64) 99999-8888"
                autoComplete="username"
                className="v2-input text-lg" />
            </div>

            <CampoSenha rotulo="Sua senha" valor={senha} onChange={setSenha} onEnter={entrar}
              className="v2-input text-lg" />

            <button onClick={entrar} disabled={entrando}
              className="v2-btn-primary w-full py-4 text-base disabled:opacity-60">
              {entrando ? <><Loader2 size={18} className="animate-spin" /> Entrando...</> : <><LogIn size={18} /> Entrar</>}
            </button>

            <button onClick={() => setEsqueci(true)}
              className="w-full text-center text-sm text-noite-500 hover:text-campo-600 py-1">
              Esqueci minha senha
            </button>
          </div>

          <div className="mt-7 pt-6 border-t text-center">
            <p className="text-sm text-noite-600 mb-3">
              <strong className="text-noite-900">Ainda não tem cadastro?</strong>
            </p>
            <button onClick={() => { setModo('cadastrar'); setErro(''); }}
              className="v2-btn-outline w-full py-3.5">
              <UserPlus size={18} /> Criar minha conta
            </button>
          </div>
        </div>
      </div>

      {esqueci && (
        <EsqueciSenhaModal
          initialWhatsapp={whatsapp.replace(/\D/g, '')}
          onClose={() => setEsqueci(false)}
        />
      )}
    </div>
  );
}
