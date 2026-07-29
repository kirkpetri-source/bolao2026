import React, { useState } from 'react';
import { Trophy, LogOut, ShieldAlert, Loader2 } from 'lucide-react';
import { useApp } from './AppContext.js';
import { loginWithWhatsapp } from './authService.js';
import { PlataformaTab } from './AdminPanel.jsx';

// Console da plataforma, em /plataforma.
//
// Separado do painel de bolão de propósito: operar o SaaS (ver a carteira, os
// clientes e as mensalidades) é outro trabalho, com outro risco, e não deveria
// estar a uma aba de distância de quem está administrando um bolão. A rota por
// si só não protege nada — quem protege são a conta e as regras do Firestore —
// mas ela permite um login próprio e evita exposição acidental.
export default function Plataforma() {
  const { currentUser, logout } = useApp();
  const [whatsapp, setWhatsapp] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [entrando, setEntrando] = useState(false);

  const entrar = async () => {
    setErro(''); setEntrando(true);
    try {
      await loginWithWhatsapp(whatsapp, senha);
    } catch (e) {
      setErro('Não foi possível entrar. Confira os dados.');
    } finally {
      setEntrando(false);
    }
  };

  if (!currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-noite-900">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2 mb-8 justify-center">
            <div className="w-9 h-9 bg-campo-600 rounded-xl flex items-center justify-center">
              <Trophy size={17} className="text-ouro-500" />
            </div>
            <span className="font-display text-white text-base" style={{ letterSpacing: '0.2em' }}>PLATAFORMA</span>
          </div>
          <div className="bg-white rounded-2xl p-6 shadow-2xl">
            <h1 className="font-display text-2xl text-noite-900 mb-1" style={{ letterSpacing: '0.03em' }}>ACESSO RESTRITO</h1>
            <p className="text-sm text-noite-500 mb-5">Console de administração do SaaS.</p>
            {erro && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg mb-4 text-sm">{erro}</div>}
            <div className="space-y-3">
              <div>
                <label className="v2-label">Usuário</label>
                <input type="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value.replace(/\D/g, ''))} className="v2-input" />
              </div>
              <div>
                <label className="v2-label">Senha</label>
                <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && entrar()} className="v2-input" />
              </div>
              <button onClick={entrar} disabled={entrando} className="v2-btn-primary w-full py-3 disabled:opacity-60">
                {entrando && <Loader2 size={16} className="animate-spin" />} Entrar
              </button>
            </div>
          </div>
          <p className="text-center text-noite-500 text-xs mt-5">
            Procurando o seu bolão? <a href="/" className="text-ouro-500 underline">Entre por aqui</a>.
          </p>
        </div>
      </div>
    );
  }

  // Conta sem o papel de plataforma: recusa explícita, sem revelar nada do SaaS.
  if (!currentUser.globalAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 page-bg">
        <div className="bg-white rounded-2xl border p-8 max-w-md text-center">
          <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
            <ShieldAlert size={28} className="text-red-600" />
          </div>
          <h1 className="font-display text-xl text-noite-900 mb-2" style={{ letterSpacing: '0.03em' }}>ACESSO NEGADO</h1>
          <p className="text-sm text-noite-500 mb-5">
            Esta área é da administração da plataforma. Sua conta administra bolões,
            e o painel deles fica na página inicial.
          </p>
          <div className="flex gap-2 justify-center">
            <a href="/" className="v2-btn-primary px-5 py-2.5 text-sm">Ir para o meu bolão</a>
            <button onClick={logout} className="v2-btn-outline px-5 py-2.5 text-sm">Sair</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen page-bg">
      <header className="bg-noite-900 px-4 sm:px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-campo-600 rounded-lg flex items-center justify-center">
            <Trophy size={15} className="text-ouro-500" />
          </div>
          <span className="font-display text-white text-sm" style={{ letterSpacing: '0.2em' }}>PLATAFORMA</span>
        </div>
        <div className="flex items-center gap-3">
          <a href="/" className="text-noite-300 text-sm hover:text-white">Meu bolão</a>
          <button onClick={logout} className="text-noite-300 text-sm hover:text-white inline-flex items-center gap-1.5">
            <LogOut size={15} /> Sair
          </button>
        </div>
      </header>
      <main className="p-4 sm:p-6">
        <PlataformaTab />
      </main>
    </div>
  );
}
