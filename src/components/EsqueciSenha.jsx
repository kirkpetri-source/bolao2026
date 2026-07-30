import React, { useState } from 'react';
import { Key, X, CheckCircle } from 'lucide-react';

// Recuperação de senha por WhatsApp.
//
// Vivia dentro do App.jsx e por isso só existia na tela de login de um bolão.
// A portaria (/entrar) não tinha como oferecer — e é justamente lá que cai
// quem não consegue entrar. Extraído para os dois usarem o mesmo.
//
// A resposta é sempre genérica ("se este número estiver cadastrado..."), de
// propósito: dizer que o número não existe entregaria a lista de participantes
// a qualquer um que fosse testando números.
export function EsqueciSenhaModal({ initialWhatsapp, onClose }) {
  const [phone, setPhone] = useState(initialWhatsapp || '');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length < 10) { setError('Digite o número com DDD, só os números.'); return; }
    setError(''); setLoading(true);
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ whatsapp: digits }),
      });
      setDone(true);
    } catch {
      setError('Não foi possível processar agora. Tente de novo em instantes.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-modal animate-slide-up">
        <div className="p-6 border-b flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Key className="text-campo-600" size={22} />
            <h3 className="font-display text-xl text-noite-900" style={{ letterSpacing: '0.04em' }}>ESQUECI MINHA SENHA</h3>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="text-gray-400 hover:text-gray-600 transition-colors"><X size={24} /></button>
        </div>

        {done ? (
          <div className="p-6 space-y-4 text-center">
            <CheckCircle className="text-green-600 mx-auto" size={40} />
            <p className="text-noite-700 leading-relaxed">
              Se este número estiver cadastrado, você vai receber uma <strong>senha
              nova pelo WhatsApp</strong>, em alguns minutos.
            </p>
            <p className="text-sm text-noite-500">
              É só voltar aqui e entrar com ela. Depois você pode trocar por uma senha sua.
            </p>
            <button onClick={onClose} className="v2-btn-primary w-full py-3">Entendi</button>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            <p className="text-sm text-noite-500 leading-relaxed">
              Digite o número de WhatsApp que você usou no cadastro. Vamos mandar uma
              senha nova por mensagem.
            </p>
            <div>
              <label className="v2-label">Seu WhatsApp</label>
              <input
                type="tel"
                inputMode="numeric"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
                placeholder="64999998888"
                className="v2-input text-lg"
                autoFocus
              />
              <p className="text-xs text-noite-400 mt-1">Com o DDD, só números.</p>
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="flex gap-3 pt-1">
              <button onClick={onClose} className="v2-btn-outline flex-1 py-3">Cancelar</button>
              <button onClick={handleConfirm} disabled={loading} className="v2-btn-primary flex-1 py-3 disabled:opacity-60">
                {loading ? 'Enviando...' : 'Enviar senha nova'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default EsqueciSenhaModal;
