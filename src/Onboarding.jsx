import React, { useState } from 'react';
import { Trophy, Copy, Check, ArrowLeft, Loader2 } from 'lucide-react';
import { useApp } from './AppContext.js';
import { DarkToggle } from './components/shared.jsx';
import { loginWithWhatsapp, authErrorMessage } from './authService.js';
import { rememberTenant, inviteUrl } from './tenant.js';

// Onboarding de organizador (Fase 3 do SaaS): cria a conta do dono + o tenant
// (bolão) + configuração inicial via /api/tenants/create (Admin SDK), e entrega
// o link de convite para os participantes.
const OnboardingScreen = ({ setView }) => {
  const { login } = useApp();
  const [form, setForm] = useState({
    bolaoName: '', name: '', whatsapp: '', password: '', confirmPassword: '',
    pixKey: '', betValue: 15,
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null); // { tenantId, inviteUrl }
  const [copied, setCopied] = useState(false);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleCreate = async () => {
    if (!form.bolaoName.trim() || !form.name.trim() || !form.whatsapp || !form.password) {
      setError('Preencha nome do bolão, seu nome, WhatsApp e senha.'); return;
    }
    if (form.password !== form.confirmPassword) { setError('Senhas diferentes!'); return; }
    if (form.password.length < 6) { setError('Senha mínimo 6 caracteres!'); return; }
    setError(''); setSaving(true);
    try {
      const res = await fetch('/api/tenants/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bolaoName: form.bolaoName.trim(),
          name: form.name.trim(),
          whatsapp: form.whatsapp,
          password: form.password,
          pixKey: form.pixKey.trim(),
          betValue: Number(form.betValue) || 15,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao criar o bolão');
      rememberTenant(data.tenantId);
      setCreated({ tenantId: data.tenantId, inviteUrl: inviteUrl(data.tenantId) });
    } catch (e) {
      setError(e?.message || 'Falha ao criar o bolão');
    } finally {
      setSaving(false);
    }
  };

  const handleEnter = async () => {
    setError('');
    try {
      const user = await loginWithWhatsapp(form.whatsapp, form.password);
      login(user); // o observer de Auth resolve o tenant novo e o papel de owner
    } catch (e) {
      setError(authErrorMessage(e));
      setView('login');
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(created.inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="min-h-screen font-body flex flex-col lg:flex-row">
      {/* ── Left: decorative panel ── */}
      <div className="login-hero hidden lg:flex lg:w-5/12 xl:w-1/2 flex-col relative overflow-hidden p-10 xl:p-14 min-h-screen">
        <div className="absolute top-0 right-0 w-px h-full bg-gradient-to-b from-transparent via-ouro-500/40 to-transparent pointer-events-none" />
        <div className="flex items-center gap-3 mb-auto">
          <div className="w-9 h-9 bg-campo-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <Trophy size={17} className="text-ouro-500" />
          </div>
          <span className="font-display text-white text-base" style={{ letterSpacing: '0.2em' }}>BOLÃO BRASILEIRÃO</span>
        </div>
        <div className="my-auto pb-12">
          <p className="text-campo-400 text-xs font-semibold uppercase mb-5" style={{ letterSpacing: '0.25em' }}>Para organizadores</p>
          <h2 className="font-display text-white leading-none" style={{ fontSize: 'clamp(56px, 8vw, 88px)' }}>
            SEU BOLÃO,<br />
            <span className="text-ouro-500">SUAS REGRAS</span>
          </h2>
          <p className="text-noite-500 text-sm mt-6 max-w-xs leading-relaxed font-medium">
            Monte o bolão do seu bar, empresa ou grupo de amigos: cobrança PIX, ranking automático e avisos por WhatsApp — sem planilha.
          </p>
        </div>
        <div className="flex gap-1.5">
          <div className="h-1 flex-1 bg-campo-600 rounded-full" />
          <div className="h-1 flex-1 bg-ouro-500 rounded-full" />
          <div className="h-1 flex-[2] bg-white/10 rounded-full" />
        </div>
      </div>

      {/* ── Right: form / success ── */}
      <div className="flex-1 bg-white dark:bg-[#0C1C10] flex items-center justify-center p-6 sm:p-10 min-h-screen relative">
        <div className="absolute top-4 right-4">
          <DarkToggle variant="light" />
        </div>
        <div className="w-full max-w-md animate-slide-up">
          <div className="flex lg:hidden items-center gap-2 mb-8">
            <div className="w-8 h-8 bg-campo-600 rounded-lg flex items-center justify-center">
              <Trophy size={14} className="text-ouro-500" />
            </div>
            <span className="font-display text-noite-900 text-base" style={{ letterSpacing: '0.2em' }}>BOLÃO BRASILEIRÃO</span>
          </div>

          {created ? (
            <div>
              <div className="mb-7">
                <h2 className="font-display text-4xl text-noite-900" style={{ letterSpacing: '0.04em' }}>BOLÃO CRIADO!</h2>
                <p className="text-noite-400 text-sm mt-1.5">Compartilhe o link abaixo para os participantes entrarem direto no seu bolão.</p>
              </div>
              {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-5 text-sm animate-bounce-in">{error}</div>}
              <div className="space-y-4">
                <div>
                  <label className="v2-label">Link de convite</label>
                  <div className="flex gap-2">
                    <input type="text" readOnly value={created.inviteUrl} className="v2-input flex-1 font-mono text-sm" onFocus={(e) => e.target.select()} />
                    <button onClick={handleCopy} className="v2-btn-outline px-4" title="Copiar link">
                      {copied ? <Check size={18} className="text-green-600" /> : <Copy size={18} />}
                    </button>
                  </div>
                </div>
                <button onClick={handleEnter} className="v2-btn-primary w-full py-3.5 text-base">Entrar no meu painel</button>
                <p className="text-noite-400 text-xs leading-relaxed">
                  No painel você cria as rodadas, confere pagamentos e envia os comunicados. Guarde este link — ele também aparece nas configurações.
                </p>
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-7">
                <h2 className="font-display text-4xl text-noite-900" style={{ letterSpacing: '0.04em' }}>CRIAR MEU BOLÃO</h2>
                <p className="text-noite-400 text-sm mt-1.5">Você será o organizador: cria rodadas, valida pagamentos e envia avisos</p>
              </div>
              {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-5 text-sm animate-bounce-in">{error}</div>}
              <div className="space-y-4">
                <div>
                  <label className="v2-label">Nome do bolão</label>
                  <input type="text" placeholder="Ex.: Bolão do Bar do Zé" value={form.bolaoName} onChange={set('bolaoName')} className="v2-input" />
                </div>
                <div>
                  <label className="v2-label">Seu nome</label>
                  <input type="text" placeholder="Nome do organizador" value={form.name} onChange={set('name')} className="v2-input" />
                </div>
                <div>
                  <label className="v2-label">WhatsApp</label>
                  <input type="tel" placeholder="11999999999" value={form.whatsapp} onChange={(e) => setForm(f => ({ ...f, whatsapp: e.target.value.replace(/\D/g, '') }))} className="v2-input" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="v2-label">Senha</label>
                    <input type="password" placeholder="Mín. 6 caracteres" value={form.password} onChange={set('password')} className="v2-input" />
                  </div>
                  <div>
                    <label className="v2-label">Confirmar</label>
                    <input type="password" placeholder="Repita a senha" value={form.confirmPassword} onChange={set('confirmPassword')} className="v2-input" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="v2-label">Chave PIX (opcional)</label>
                    <input type="text" placeholder="Para receber as cartelas" value={form.pixKey} onChange={set('pixKey')} className="v2-input" />
                  </div>
                  <div>
                    <label className="v2-label">Valor da cartela (R$)</label>
                    <input type="number" min="1" value={form.betValue} onChange={set('betValue')} className="v2-input" />
                  </div>
                </div>
                <div className="pt-2 space-y-3">
                  <button onClick={handleCreate} disabled={saving} className="v2-btn-primary w-full py-3.5 text-base disabled:opacity-60">
                    {saving ? (<><Loader2 size={18} className="animate-spin" /> Criando...</>) : 'Criar bolão'}
                  </button>
                  <button onClick={() => { setError(''); setView('login'); }} className="v2-btn-ghost w-full py-2.5 text-sm">
                    <ArrowLeft size={16} /> Voltar para o login
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OnboardingScreen;
