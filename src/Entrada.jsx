import React, { useState } from 'react';
import { Trophy, LogIn, Loader2, ArrowRight } from 'lucide-react';
import { loginWithWhatsapp } from './authService.js';

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
        <div className="flex items-center gap-2.5 justify-center mb-8">
          <div className="w-10 h-10 bg-campo-600 rounded-xl flex items-center justify-center">
            <Trophy size={19} className="text-ouro-500" />
          </div>
          <span className="font-display text-noite-900 text-lg" style={{ letterSpacing: '0.18em' }}>BOLÃO BRASILEIRÃO</span>
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
              <div>
                <label className="v2-label">Senha</label>
                <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && entrar()} className="v2-input" />
              </div>
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
