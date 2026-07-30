import React, { useState, useMemo } from 'react';
import { Loader2, ArrowRight, Search, ArrowLeft, LogIn } from 'lucide-react';
import { loginWithWhatsapp } from './authService.js';
import { Marca } from './components/Marca.jsx';
import { CampoSenha } from './components/CampoSenha.jsx';
import { EsqueciSenhaModal } from './components/EsqueciSenha.jsx';

// Página de login ÚNICA do sistema, em /entrar.
//
// Como todo participante é cadastrado pelo link do organizador, a conta dele já
// nasce ligada a um bolão. Então o login não precisa perguntar nada além de
// WhatsApp e senha: quem sabe para onde levar a pessoa é o sistema, pelo
// vínculo dela (lastTenantId + membership). Uma tela só, igual para todos.
//
// Quem AINDA não tem cadastro é o único caso que precisa dizer de qual bolão
// está falando — e é o que o bloco de baixo resolve, mandando para
// /{bolao}?cadastro=1, que abre o cadastro já dentro do bolão certo.
//
// Tudo mora no MESMO cartão de propósito: a versão anterior espalhava atalho,
// login e cadastro em três caixas empilhadas, e quem tem pouca intimidade com
// internet lia três telas em vez de uma.

const formataTelefone = (digitos) => {
  const d = String(digitos || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

export default function Entrada() {
  const [whatsapp, setWhatsapp] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [entrando, setEntrando] = useState(false);
  const [esqueci, setEsqueci] = useState(false);
  const [passo, setPasso] = useState('entrar');   // 'entrar' | 'procurar'

  const [boloes, setBoloes] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [busca, setBusca] = useState('');

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
    const limpa = (x) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    return boloes.filter(b => limpa(b.nome).includes(limpa(t)) || b.slug.includes(limpa(t)));
  }, [boloes, busca]);

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

  const Cabecalho = () => (
    <div className="flex justify-center mb-8">
      <a href="/" aria-label="Página inicial"><Marca tamanho="grande" idSufixo="-entrada" /></a>
    </div>
  );

  // ── Escolher o bolão (só para quem ainda não tem cadastro) ──────────────
  if (passo === 'procurar') {
    return (
      <div className="min-h-screen page-bg font-body flex items-center justify-center p-5">
        <div className="w-full max-w-md">
          <Cabecalho />
          <div className="bg-white rounded-2xl border shadow-modal p-7">
            <button onClick={() => setPasso('entrar')}
              className="inline-flex items-center gap-1.5 text-sm text-noite-500 hover:text-noite-800 mb-5">
              <ArrowLeft size={16} /> Voltar
            </button>

            <h1 className="font-display text-2xl text-noite-900 mb-2" style={{ letterSpacing: '0.03em' }}>
              QUAL É O SEU BOLÃO?
            </h1>
            <p className="text-sm text-noite-500 leading-relaxed mb-5">
              Toque no bolão do seu grupo para fazer o seu cadastro nele.
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
                {/* ?cadastro=1 abre o formulário de cadastro já DENTRO do bolão
                    escolhido — é assim que quem não veio pelo link do
                    organizador informa de qual bolão está falando. */}
                {filtrados.map(b => (
                  <a key={b.slug} href={`/${b.slug}?cadastro=1`}
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

  // ── Login (tela principal) ──────────────────────────────────────────────
  return (
    <div className="min-h-screen page-bg font-body flex items-center justify-center p-5">
      <div className="w-full max-w-md">
        <Cabecalho />

        <div className="bg-white rounded-2xl border shadow-modal p-7">
          {/* NÃO mostramos o "último bolão visitado" aqui. O login já leva a
              pessoa ao bolão dela, e aquele atalho vinha do navegador, não da
              conta: em computador compartilhado exibia o bolão de outra
              pessoa, e no melhor caso repetia o que o login já faz. */}
          <h1 className="font-display text-2xl text-noite-900 mb-2" style={{ letterSpacing: '0.03em' }}>
            ENTRAR NO SEU BOLÃO
          </h1>
          <p className="text-sm text-noite-500 mb-6">
            Use o WhatsApp e a senha que você cadastrou. Nós te levamos direto ao seu bolão.
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

          {/* Mesmo cartão, separado por uma linha: é o segundo caso, não uma
              segunda tela. */}
          <div className="mt-7 pt-6 border-t">
            <p className="text-sm text-noite-600 text-center leading-relaxed mb-3">
              <strong className="text-noite-900">Ainda não tem cadastro?</strong><br />
              Se o organizador te mandou um link, é só tocar nele. Se não tiver o link,
              escolha o seu bolão aqui:
            </p>
            <button onClick={abrirLista} className="v2-btn-outline w-full py-3.5">
              <Search size={18} /> Escolher o meu bolão
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
