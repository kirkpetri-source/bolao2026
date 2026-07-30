import React, { useState, useEffect, useMemo } from 'react';
import { Trophy, LogIn, Loader2, ArrowRight, Search } from 'lucide-react';
import { loginWithWhatsapp } from './authService.js';
import { ultimoBolaoVisitado, esquecerTenant } from './tenant.js';
import { Marca } from './components/Marca.jsx';
import { CampoSenha } from './components/CampoSenha.jsx';

// Página da raiz do site.
//
// Antes a raiz abria o bolão padrão da plataforma. Quem digitava só o endereço
// se cadastrava lá — um bolão de teste, sem organizador de verdade, onde o
// palpite não valia nada e ninguém iria cobrar ou premiar.
//
// Agora a raiz não é bolão nenhum. Quem tem convite entra pelo link do
// organizador; quem já tem conta faz login e é levado ao bolão dele; e quem
// quer criar o próprio bolão tem o caminho à vista.
export default function Entrada({ setView }) {
  const [whatsapp, setWhatsapp] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [entrando, setEntrando] = useState(false);
  const [mostrarLogin, setMostrarLogin] = useState(false);
  // Atalho, nunca desvio: quem digitou a raiz continua vendo a raiz.
  const [ultimo, setUltimo] = useState(() => ultimoBolaoVisitado());

  // Lista de bolões para quem perdeu o link. Carregada sob demanda: na maioria
  // dos acessos a pessoa chega pelo link certo e não precisa dela.
  const [boloes, setBoloes] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [busca, setBusca] = useState('');

  const abrirLista = async () => {
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
    setErro(''); setEntrando(true);
    try {
      // O observador de autenticação leva a pessoa ao bolão dela pelo
      // lastTenantId — por isso aqui não é preciso escolher bolão nenhum.
      await loginWithWhatsapp(whatsapp, senha);
    } catch {
      setErro('Não foi possível entrar. Confira o WhatsApp e a senha.');
    } finally {
      setEntrando(false);
    }
  };

  return (
    <div className="min-h-screen page-bg font-body flex items-center justify-center p-5">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center gap-3 mb-8">
          <a href="/" className="inline-flex" aria-label="Voltar para a página inicial">
            <Marca idSufixo="-entrada" />
          </a>
        </div>

        <div className="bg-white rounded-2xl border shadow-modal p-7">
          <h1 className="font-display text-2xl text-noite-900 mb-2" style={{ letterSpacing: '0.03em' }}>
            ENTRE PELO LINK DO SEU BOLÃO
          </h1>
          <p className="text-sm text-noite-500 leading-relaxed mb-6">
            Cada bolão tem um endereço próprio, que o organizador envia no grupo —
            algo como <span className="font-mono text-noite-700">.../nome-do-bolao</span>.
            É por ele que você se cadastra e faz seus palpites.
          </p>

          {ultimo && (
            <div className="rounded-xl border border-gray-200 p-3 mb-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-noite-400">Você esteve aqui</p>
                <p className="text-sm font-semibold text-noite-800 truncate">{ultimo}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <a href={`/${ultimo}`} className="v2-btn-primary px-4 py-2 text-sm">Voltar</a>
                <button onClick={() => { esquecerTenant(); setUltimo(null); }}
                  className="text-xs text-noite-400 hover:text-noite-700">Esquecer</button>
              </div>
            </div>
          )}

          {boloes === null ? (
            <button onClick={abrirLista} disabled={buscando} className="v2-btn-outline w-full py-3 mb-3 disabled:opacity-60">
              {buscando ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
              Não sei o nome — ver a lista de bolões
            </button>
          ) : (
            <div className="mb-4">
              <label className="v2-label">Procure o seu bolão</label>
              <input type="text" value={busca} onChange={(e) => setBusca(e.target.value)}
                placeholder="Digite parte do nome" className="v2-input mb-2" autoFocus />
              <div className="max-h-56 overflow-y-auto rounded-xl border divide-y">
                {filtrados.length === 0 && (
                  <p className="text-sm text-noite-400 p-3">
                    {boloes.length === 0 ? 'Nenhum bolão disponível na lista.' : 'Nenhum bolão com esse nome.'}
                  </p>
                )}
                {filtrados.map(b => (
                  <a key={b.slug} href={`/${b.slug}`}
                    className="flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-gray-50 transition-colors">
                    <span className="text-sm font-medium text-noite-800 truncate">{b.nome}</span>
                    <ArrowRight size={15} className="text-noite-400 flex-shrink-0" />
                  </a>
                ))}
              </div>
              <p className="text-xs text-noite-400 mt-2">
                Não achou? Peça o link ao organizador — bolões fechados não aparecem aqui.
              </p>
            </div>
          )}

          {!mostrarLogin ? (
            <button onClick={() => setMostrarLogin(true)} className="v2-btn-outline w-full py-3 mb-3">
              <LogIn size={18} /> Já tenho conta
            </button>
          ) : (
            <div className="space-y-3 mb-3">
              {erro && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">{erro}</div>}
              <div>
                <label className="v2-label">WhatsApp</label>
                <input type="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value.replace(/\D/g, ''))}
                  placeholder="11999999999" className="v2-input" />
              </div>
              <CampoSenha rotulo="Senha" valor={senha} onChange={setSenha} onEnter={entrar} />
              <button onClick={entrar} disabled={entrando} className="v2-btn-primary w-full py-3 disabled:opacity-60">
                {entrando && <Loader2 size={16} className="animate-spin" />} Entrar
              </button>
              <p className="text-xs text-noite-400 text-center">
                Você será levado ao bolão em que já participa.
              </p>
            </div>
          )}
        </div>

        <div className="mt-5 rounded-2xl border-2 border-ouro-500 bg-ouro-50 dark:bg-ouro-500/10 p-5">
          <div className="flex items-center gap-2 mb-1.5">
            <Trophy size={18} className="text-ouro-600" />
            <h2 className="font-display text-lg text-noite-900" style={{ letterSpacing: '0.04em' }}>QUER ORGANIZAR UM BOLÃO?</h2>
          </div>
          <p className="text-noite-500 text-sm leading-relaxed mb-4">
            Monte o seu, convide a galera e administre rodadas, pagamentos e resultados
            pelo painel do organizador.
          </p>
          <button onClick={() => setView('onboard')}
            className="w-full py-3 rounded-xl font-semibold text-[#0a0f1a] bg-ouro-500 hover:bg-ouro-400 shadow-button-ouro transition-colors inline-flex items-center justify-center gap-2">
            Criar meu bolão <ArrowRight size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
