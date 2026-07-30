import React, { useState, useEffect, useMemo } from 'react';
import { Loader2, ArrowRight, Search, ArrowLeft, LogIn } from 'lucide-react';
import { loginWithWhatsapp } from './authService.js';
import { ultimoBolaoVisitado, esquecerTenant } from './tenant.js';
import { Marca } from './components/Marca.jsx';
import { CampoSenha } from './components/CampoSenha.jsx';
import { EsqueciSenhaModal } from './components/EsqueciSenha.jsx';

// Portaria do participante, em /entrar.
//
// A versão anterior colocava três caminhos com o MESMO peso — atalho do último
// bolão, lista de bolões e "já tenho conta" — e escondia o formulário de login
// atrás de um clique. Quem chega aqui já disse "já participo": o que essa
// pessoa quer é entrar. Uma tela com três opções iguais e nenhuma ação óbvia
// trava justamente quem tem menos familiaridade com internet.
//
// Regras que segui, pensando em quem usa o celular só para WhatsApp:
// - uma ação principal, visível, sem clique intermediário;
// - vocabulário do dia a dia: "seu WhatsApp", "sua senha" — nada de "endereço
//   do bolão" ou exemplo com barra e hífen, que parece código;
// - campos e botão grandes, com o número formatado enquanto digita;
// - a busca de bolão vira uma TELA à parte, e não mais um bloco competindo;
// - erro que diz o que fazer, e não só o que deu errado.
//
// O cartão "quer organizar um bolão?" saiu daqui: essa oferta é da página
// inicial, e aqui só disputava atenção com quem já é participante.

const formataTelefone = (digitos) => {
  const d = String(digitos || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

// "bolao-do-ze" → "Bolao Do Ze". Só entra em cena se o bolão não estiver na
// lista pública; ainda assim é bem mais legível que o endereço cru.
const nomeLegivel = (slug) =>
  String(slug || '').split('-').filter(Boolean)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');

export default function Entrada({ setView }) {
  const [whatsapp, setWhatsapp] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [entrando, setEntrando] = useState(false);
  const [esqueci, setEsqueci] = useState(false);

  // Passo atual: 'entrar' (padrão) ou 'procurar'. Um de cada vez.
  const [passo, setPasso] = useState('entrar');

  const [ultimo, setUltimo] = useState(() => ultimoBolaoVisitado());
  const [nomeDoUltimo, setNomeDoUltimo] = useState('');

  const [boloes, setBoloes] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [busca, setBusca] = useState('');

  // Mostrar o nome de verdade do bolão, não o endereço com hífens: "bolao-lion-tech"
  // não diz nada para quem só quer voltar para onde estava.
  useEffect(() => {
    if (!ultimo) return;
    let cancelado = false;
    fetch('/api/tenants/list')
      .then(r => r.json())
      .then(d => {
        if (cancelado) return;
        const achado = (d.boloes || []).find(b => b.slug === ultimo);
        if (achado?.nome) setNomeDoUltimo(achado.nome);
      })
      .catch(() => {});
    return () => { cancelado = true; };
  }, [ultimo]);

  const abrirLista = async () => {
    setPasso('procurar');
    if (boloes) return;
    setBuscando(true);
    try {
      const r = await fetch('/api/tenants/list');
      const d = await r.json();
      setBoloes(r.ok ? (d.boloes || []) : []);
    } catch { setBoloes([]); } finally { setBuscando(false); }
  };

  const filtrados = useMemo(() => {
    if (!boloes) return [];
    const t = busca.trim().toLowerCase();
    if (!t) return boloes;
    // Compara sem acento: quem procura "bolao do ze" acha "Bolão do Zé".
    const limpa = (x) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    return boloes.filter(b => limpa(b.nome).includes(limpa(t)) || b.slug.includes(limpa(t)));
  }, [boloes, busca]);

  const entrar = async () => {
    const numero = whatsapp.replace(/\D/g, '');
    if (numero.length < 10) { setErro('Digite seu número com DDD. Exemplo: (64) 99999-8888'); return; }
    if (!senha) { setErro('Digite a sua senha.'); return; }

    setErro(''); setEntrando(true);
    try {
      await loginWithWhatsapp(numero, senha);
    } catch {
      setErro('Número ou senha não conferem. Confira e tente de novo — ou toque em "Esqueci minha senha".');
    } finally {
      setEntrando(false);
    }
  };

  // ── Tela de procurar bolão ──────────────────────────────────────────────
  if (passo === 'procurar') {
    return (
      <div className="min-h-screen page-bg font-body flex items-center justify-center p-5">
        <div className="w-full max-w-md">
          <div className="flex justify-center mb-8">
            <a href="/" aria-label="Página inicial"><Marca idSufixo="-entrada" /></a>
          </div>

          <div className="bg-white rounded-2xl border shadow-modal p-7">
            <button onClick={() => setPasso('entrar')}
              className="inline-flex items-center gap-1.5 text-sm text-noite-500 hover:text-noite-800 mb-5">
              <ArrowLeft size={16} /> Voltar
            </button>

            <h1 className="font-display text-2xl text-noite-900 mb-2" style={{ letterSpacing: '0.03em' }}>
              QUAL É O SEU BOLÃO?
            </h1>
            <p className="text-sm text-noite-500 leading-relaxed mb-5">
              Toque no bolão do seu grupo para se cadastrar e começar a jogar.
            </p>

            <input type="text" value={busca} onChange={(e) => setBusca(e.target.value)}
              placeholder="Digite o nome do bolão" className="v2-input text-lg mb-3" autoFocus />

            {buscando ? (
              <div className="flex items-center justify-center gap-2 py-8 text-noite-500">
                <Loader2 size={20} className="animate-spin" /> Carregando...
              </div>
            ) : (
              <div className="rounded-xl border divide-y overflow-hidden">
                {filtrados.length === 0 && (
                  <p className="text-sm text-noite-500 p-4">
                    {boloes && boloes.length === 0
                      ? 'Nenhum bolão disponível na lista no momento.'
                      : 'Nenhum bolão com esse nome.'}
                  </p>
                )}
                {filtrados.map(b => (
                  <a key={b.slug} href={`/${b.slug}`}
                    className="flex items-center justify-between gap-3 px-4 py-4 hover:bg-gray-50 transition-colors">
                    <span className="font-medium text-noite-800">{b.nome}</span>
                    <ArrowRight size={18} className="text-campo-600 flex-shrink-0" />
                  </a>
                ))}
              </div>
            )}

            <div className="mt-5 rounded-xl bg-gray-50 dark:bg-white/5 p-4">
              <p className="text-sm text-noite-600 leading-relaxed">
                <strong>Não achou o seu?</strong> Alguns bolões são fechados e não
                aparecem nesta lista. Peça ao organizador para te mandar o link do
                bolão pelo WhatsApp.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Tela principal: entrar ──────────────────────────────────────────────
  return (
    <div className="min-h-screen page-bg font-body flex items-center justify-center p-5">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <a href="/" aria-label="Página inicial"><Marca idSufixo="-entrada" /></a>
        </div>

        {/* Atalho para quem já esteve num bolão: é o caminho mais curto e por
            isso vem antes de tudo, com o NOME do bolão, não o endereço. */}
        {ultimo && (
          <a href={`/${ultimo}`}
            className="flex items-center justify-between gap-3 bg-white rounded-2xl border-2 border-campo-600 p-4 mb-4 hover:bg-campo-50 dark:hover:bg-campo-600/10 transition-colors">
            <div className="min-w-0">
              <p className="text-xs text-noite-500 mb-0.5">Você já entrou aqui antes</p>
              <p className="font-semibold text-noite-900 truncate">
                {nomeDoUltimo || nomeLegivel(ultimo)}
              </p>
            </div>
            <span className="v2-btn-primary px-5 py-2.5 text-sm flex-shrink-0">Abrir</span>
          </a>
        )}

        <div className="bg-white rounded-2xl border shadow-modal p-7">
          <h1 className="font-display text-2xl text-noite-900 mb-2" style={{ letterSpacing: '0.03em' }}>
            ENTRAR NO SEU BOLÃO
          </h1>
          <p className="text-sm text-noite-500 mb-6">
            Use o WhatsApp e a senha que você cadastrou.
          </p>

          {erro && (
            <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 px-4 py-3 rounded-xl text-sm mb-4">
              {erro}
            </div>
          )}

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
        </div>

        {/* Segundo caminho, claramente separado e em segundo plano. */}
        <div className="mt-5 bg-white rounded-2xl border p-6 text-center">
          <p className="font-semibold text-noite-900 mb-1">Ainda não tem cadastro?</p>
          <p className="text-sm text-noite-500 leading-relaxed mb-4">
            Para jogar, você precisa entrar no bolão do seu grupo. Se o organizador te
            mandou um link, é só tocar nele. Se não tiver o link, procure aqui:
          </p>
          <button onClick={abrirLista} className="v2-btn-outline w-full py-3.5">
            <Search size={18} /> Procurar o meu bolão
          </button>
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
