import React, { useState, useEffect, useRef, createContext, useContext, useMemo } from 'react';
import { Trophy, Users, Calendar, Clock, TrendingUp, LogOut, Eye, EyeOff, Plus, Edit2, Trash2, Upload, ExternalLink, X, UserPlus, Target, Award, ChevronDown, ChevronUp, Check, Key, DollarSign, CheckCircle, XCircle, AlertCircle, FileText, Download, Store, Filter, Loader2, Megaphone, Send, Search, Bell, Copy, RefreshCcw, History, Moon, Sun } from 'lucide-react';
import { collection, addDoc, updateDoc, deleteDoc, doc, setDoc, getDocs, getDoc, onSnapshot, serverTimestamp, query, where, orderBy, limit } from 'firebase/firestore';
import { jsPDF } from 'jspdf';
import axios from 'axios';
import { MESSAGE_TEMPLATES, TEMPLATE_CATEGORIES, buildTemplateText as buildTemplateTextUtil, validateMessageTags, normalizeTags, compileTemplate } from './utils/messageTemplates.js';
import { db, PUBLIC_CONFIG_ID, pickPublicConfig } from './firebase.js';
import { SERIE_A_2026_TEAMS } from './constants.js';
import { generateCartelaCode, fmtBRL, sortMatchesByDate, MATCH_FINISH_AFTER_MS, MATCH_IN_PROGRESS_STATUSES, isMatchEffectivelyFinished, getSafeLogo, markdownToHtml } from './utils/helpers.js';
import { loginWithWhatsapp, registerWithWhatsapp, logout as fbLogout, observeAuth, authErrorMessage, changeOwnPassword, changeMyPassword, adminCreateUser, getIdToken } from './authService.js';

const AppContext = createContext();
const useApp = () => useContext(AppContext);

const initializeDatabase = async () => {
  try {
    const usersSnapshot = await getDocs(collection(db, 'users'));
    const teamsSnapshot = await getDocs(collection(db, 'teams'));
    const settingsSnapshot = await getDocs(collection(db, 'settings'));
    
    // Se já há dados, não reinicializa
    if (!usersSnapshot.empty && !teamsSnapshot.empty) {
      console.log('✅ Database initialized');
      return;
    }

    // Concurrency guard: usa um doc de lock para evitar inicializações simultâneas
    const { doc: docRef, getDoc: getDocSnap, setDoc } = await import('firebase/firestore');
    const lockRef = docRef(db, '_locks', 'init');
    const lockSnap = await getDocSnap(lockRef);
    if (lockSnap.exists()) {
      const lockTime = lockSnap.data()?.timestamp?.toDate?.() || new Date(lockSnap.data()?.timestamp || 0);
      // Se o lock tem menos de 60s, outro processo está inicializando
      if (Date.now() - lockTime.getTime() < 60000) {
        console.log('⏳ Another process is initializing, skipping...');
        return;
      }
    }
    await setDoc(lockRef, { timestamp: serverTimestamp() });

    console.log('🔄 Initializing...');

    // Usuários NÃO são mais semeados aqui: a autenticação é via Firebase Auth.
    // O admin de um ambiente novo deve ser criado por um script/onboarding que
    // cria a conta no Auth + o doc /users (sem senha em texto no código).

    // Inicializa times apenas se a coleção estiver vazia, com verificação individual
    if (teamsSnapshot.empty) {
      // Re-checa logo antes de inserir (outra tab pode ter inserido entre o check e agora)
      const freshTeams = await getDocs(collection(db, 'teams'));
      if (freshTeams.empty) {
        for (const team of SERIE_A_2026_TEAMS) {
          await addDoc(collection(db, 'teams'), { ...team, createdAt: serverTimestamp() });
        }
      }
    }

    if (settingsSnapshot.empty) {
      await addDoc(collection(db, 'settings'), {
        whatsappMessage: '🏆 *BOLÃO BRASILEIRÃO 2026*\n\n📋 *{RODADA}*\n🎫 *Cartela: {CARTELA}*\n✅ Confirmado!\n\n{PALPITES}\n\n🏦 Pagamento via PIX\n🔑 Chave: {PIX}\n👤 Destinatário: {DESTINATARIO}\n\n💰 R$ 15,00\n⚠️ *Não pode alterar após pagamento*\n\nBoa sorte! 🍀',
        chargeMessageTemplate: 'Olá {NOME},\n\nIdentificamos que o pagamento da sua cartela da {RODADA} ainda está pendente.\n\nValor: R$ {VALOR}\nCartela: {CARTELA}\n\nPor favor, conclua o pagamento para validar sua participação no ranking e na premiação. Obrigado! 🙏',
        devolution: {
          instanceName: '',
          link: '',
          token: ''
        },
        maintenanceMode: false,
        maintenanceMessage: 'Estamos realizando uma manutenção programada para melhorar sua experiência. Por favor, tente novamente em breve.',
        maintenanceUntil: null,
        maintenanceAllowedIps: [],
        maintenanceSchedule: { start: null, end: null },
        betValue: 15,
        whatsapp: {
          apiToken: '',
          number: '',
          notifyEnabled: true,
          notifyEvents: { charges: true, approvals: true, results: true },
          defaultTemplates: {
            confirm: '🏆 *BOLÃO BRASILEIRÃO 2026*\n\n📋 *{RODADA}*\n🎫 *Cartela: {CARTELA}*\n✅ Confirmado!\n\n{PALPITES}\n\n🏦 Pagamento via PIX\n🔑 Chave: {PIX}\n👤 Destinatário: {DESTINATARIO}\n\n💰 R$ 15,00\n⚠️ *Não pode alterar após pagamento*\n\nBoa sorte! 🍀',
            charge: 'Olá {NOME},\n\nIdentificamos que o pagamento da sua cartela da {RODADA} ainda está pendente.\n\nValor: R$ {VALOR}\nCartela: {CARTELA}\n\nPor favor, conclua o pagamento para validar sua participação no ranking e na premiação. Obrigado! 🙏'
          }
        },
        betConfig: {
          minBet: 10,
          maxBet: 100,
          bonus: { enabled: false, percent: 0 },
          fees: { adminPercent: 10, establishmentPercent: 5 },
          typesLimitsText: ''
        },
        payment: {
          provider: 'pix_manual',
          pixKey: '',
          useEnvCredentials: false
        },
        termsOfUse: '',
        systemPolicies: '',
        limitsRestrictions: '',
        complianceConfig: '',
        createdAt: serverTimestamp()
      });
    }

    console.log('🎉 Done!');
  } catch (error) {
    console.error('Error:', error);
  }
};

const sendWhatsAppMessage = (userPhone, roundName, predictions, teams, messageTemplate, cartelaCode, pixKey, pixRecipientName) => {
  let palpitesText = '';
  predictions.forEach((pred, i) => {
    const homeTeam = teams.find(t => t.id === pred.match.homeTeamId);
    const awayTeam = teams.find(t => t.id === pred.match.awayTeamId);
    palpitesText += `${i + 1}. ${homeTeam?.name} ${pred.homeScore} x ${pred.awayScore} ${awayTeam?.name}\n`;
  });
  
  // Usar a mensagem do template fornecido
  let message = messageTemplate
    .replace('{RODADA}', roundName)
    .replace('{CARTELA}', cartelaCode)
    .replace('{PALPITES}', palpitesText.trim());

  // Incluir PIX e destinatário (substituir tags se existirem, ou anexar)
  const hasPixTag = /\{PIX\}/.test(message);
  const hasDestTag = /\{DESTINATARIO\}/.test(message);
  if (hasPixTag) message = message.replace('{PIX}', pixKey || '{PIX}');
  if (hasDestTag) message = message.replace('{DESTINATARIO}', pixRecipientName || '{DESTINATARIO}');
  const extras = [];
  if (!hasPixTag && pixKey) extras.push(`🔑 Chave PIX: ${pixKey}`);
  if (!hasDestTag && pixRecipientName) extras.push(`👤 Destinatário: ${pixRecipientName}`);
  if (extras.length) message = `${message}\n\n${extras.join('\n')}`;
  
  console.log('Mensagem formatada:', message);
  
  // Adicionar +55 se o número não começar com +
  let formattedPhone = userPhone.replace(/\D/g, '');
  if (!formattedPhone.startsWith('55')) {
    formattedPhone = '55' + formattedPhone;
  }
  
  console.log('Abrindo WhatsApp para:', formattedPhone);
  window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(message)}`, '_blank');
};

const AppProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [establishments, setEstablishments] = useState([]);
  const [settings, setSettings] = useState(null);
  const [communications, setCommunications] = useState([]);
  const [teamImportRequests, setTeamImportRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  // Dark mode — persists via localStorage
  const [darkMode, setDarkMode] = useState(() => {
    try {
      const stored = localStorage.getItem('bb2026.darkMode');
      return stored === null ? true : stored === 'true';
    } catch { return true; }
  });
  useEffect(() => {
    if (darkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    try { localStorage.setItem('bb2026.darkMode', String(darkMode)); } catch {}
  }, [darkMode]);
  const toggleDark = () => setDarkMode(d => !d);

  // Sessão via Firebase Auth (persistência nativa). Mantemos apenas um timeout
  // de inatividade de 10 min por cima do Auth.
  const SESSION_TIMEOUT_MS = 10 * 60 * 1000;

  // Compat: define o usuário atual imediatamente (o observer de Auth confirma depois).
  const login = (user) => { setCurrentUser(user); };

  const requireAdmin = () => {
    if (!currentUser?.isAdmin) {
      throw new Error('Ação restrita ao administrador');
    }
  };

  const logout = async () => {
    try { await fbLogout(); } catch (e) { console.error('logout:', e); }
    setCurrentUser(null);
  };

  // Dados públicos (não exigem login): libera a tela e carrega estabelecimentos
  // (usados no formulário de cadastro, antes do login).
  useEffect(() => {
    setLoading(false);
    const unsub = onSnapshot(collection(db, 'establishments'),
      s => setEstablishments(s.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => console.error('establishments:', err));
    return () => unsub();
  }, []);

  // Dados protegidos: só após autenticação. Re-assina ao trocar de usuário e
  // limpa ao deslogar. Coleções de admin só são assinadas por admin.
  useEffect(() => {
    if (!currentUser) {
      setUsers([]); setTeams([]); setRounds([]); setPredictions([]);
      setCommunications([]); setTeamImportRequests([]);
      return;
    }
    const isAdminUser = !!currentUser.isAdmin;
    if (isAdminUser) { initializeDatabase().catch(err => console.error('initDb:', err)); }

    const uns = [
      onSnapshot(collection(db, 'rounds'), s => setRounds(s.docs.map(d => ({ id: d.id, ...d.data() }))), err => console.error('rounds:', err)),
      onSnapshot(collection(db, 'teams'), s => setTeams(s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name))), err => console.error('teams:', err)),
      onSnapshot(collection(db, 'predictions'), s => setPredictions(s.docs.map(d => ({ id: d.id, ...d.data() }))), err => console.error('predictions:', err)),
      onSnapshot(collection(db, 'users'), s => setUsers(s.docs.map(d => { const data = d.data(); const { password, ...rest } = data; return { id: d.id, ...rest }; })), err => console.error('users:', err)),
    ];
    if (isAdminUser) {
      uns.push(
        onSnapshot(collection(db, 'communications'), s => setCommunications(s.docs.map(d => ({ id: d.id, ...d.data() }))), err => console.error('communications:', err)),
        onSnapshot(collection(db, 'team_import_requests'), s => setTeamImportRequests(s.docs.map(d => ({ id: d.id, ...d.data() }))), err => console.error('import_requests:', err)),
      );
    }
    return () => uns.forEach(u => u());
  }, [currentUser?.id, currentUser?.isAdmin]);

  // Configurações baseadas no papel: admin lê /settings completo (com segredos);
  // usuário comum lê apenas /public_config/main (sem segredos). Ao carregar o
  // settings completo, o admin espelha os campos públicos em public_config.
  useEffect(() => {
    const isAdmin = !!currentUser?.isAdmin;
    let unsub;
    if (isAdmin) {
      unsub = onSnapshot(collection(db, 'settings'), s => {
        const full = s.docs.length > 0 ? { id: s.docs[0].id, ...s.docs[0].data() } : null;
        setSettings(full);
        if (full) {
          setDoc(doc(db, 'public_config', PUBLIC_CONFIG_ID), pickPublicConfig(full), { merge: true })
            .catch(err => console.error('sync public_config:', err));
        }
      });
    } else {
      unsub = onSnapshot(doc(db, 'public_config', PUBLIC_CONFIG_ID), snap => {
        setSettings(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      });
    }
    return () => { if (unsub) unsub(); };
  }, [currentUser?.isAdmin]);

  // Observa o estado do Firebase Auth e sincroniza currentUser com o doc /users/{uid}.
  useEffect(() => {
    const unsub = observeAuth(async (fbUser) => {
      if (!fbUser) { setCurrentUser(null); return; }
      try {
        const snap = await getDoc(doc(db, 'users', fbUser.uid));
        const tok = await fbUser.getIdTokenResult();
        if (snap.exists()) {
          const data = snap.data();
          setCurrentUser({ id: fbUser.uid, ...data, isAdmin: tok.claims.admin === true || !!data.isAdmin });
        } else {
          // Autenticado sem cadastro no Firestore: encerra a sessão.
          setCurrentUser(null);
          await fbLogout();
        }
      } catch (e) {
        console.error('auth observer:', e);
      }
    });
    return () => unsub();
  }, []);

  // Impõe expiração por inatividade (10 min) por cima da sessão do Auth.
  useEffect(() => {
    if (!currentUser) return;
    let lastActive = Date.now();
    const onActivity = () => { lastActive = Date.now(); };
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'visibilitychange', 'focus'];
    events.forEach(e => window.addEventListener(e, onActivity, { passive: true }));
    const checker = setInterval(() => {
      if (Date.now() - lastActive > SESSION_TIMEOUT_MS) { logout(); }
    }, 15000);
    return () => {
      events.forEach(e => window.removeEventListener(e, onActivity));
      clearInterval(checker);
    };
  }, [currentUser]);

  // Fechamento automático de rodadas no banco (somente admin em primeiro plano)
  useEffect(() => {
    if (!currentUser?.isAdmin) return;
    const timer = setInterval(async () => {
      try {
        const toClose = rounds.filter(r => {
          if (r.status !== 'open') return false;
          if (!r.closeAt) return false;
          const ts = new Date(r.closeAt).getTime();
          return !isNaN(ts) && Date.now() >= ts;
        });
        for (const r of toClose) {
          await updateDoc(doc(db, 'rounds', r.id), { status: 'closed' });
        }
      } catch (err) {
        console.error('Erro ao fechar rodada automaticamente:', err);
      }
    }, 30000); // verifica a cada 30s
    return () => clearInterval(timer);
  }, [currentUser, rounds]);

  const isTeamProtected = (teamId) => {
    const protectedStatuses = new Set(['open','closed','finished']);
    return rounds.some(r => {
      if (!protectedStatuses.has(r?.status)) return false;
      const matches = Array.isArray(r?.matches) ? r.matches : [];
      return matches.some(m => m?.homeTeamId === teamId || m?.awayTeamId === teamId);
    });
  };

  const value = {
    currentUser, setCurrentUser, users, teams, rounds, predictions, establishments, settings, communications, teamImportRequests, loading,
    login, logout, darkMode, toggleDark,
    addUser: async (d) => {
      const normalizeWhatsapp = (s) => {
        const str = (s || '').replace(/\D/g, '');
        return str.length > 11 ? str.slice(-11) : str;
      };
      const phone = normalizeWhatsapp(d.whatsapp);

      const usersSnap = await getDocs(collection(db, 'users'));
      const exists = usersSnap.docs.some(doc => normalizeWhatsapp(doc.data().whatsapp) === phone);
      if (exists) {
        throw new Error('WhatsApp já cadastrado!');
      }
      if (!d.password) throw new Error('Senha obrigatória para criar usuário.');

      // Cria a conta no Firebase Auth (app secundário para não derrubar a sessão do admin).
      // O uid do Auth vira o ID do doc /users — mantém o vínculo 1:1 das regras.
      const uid = await adminCreateUser({ whatsapp: phone, password: d.password });
      const { password, ...rest } = d;
      const toSave = {
        ...rest,
        whatsapp: phone,
        isAdmin: !!d.isAdmin,
        balance: d.balance || 0,
      };
      await setDoc(doc(db, 'users', uid), { ...toSave, createdAt: serverTimestamp() });
      return { id: uid, ...toSave };
    },
    updateUser: async (id, d) => {
      const isSelf = currentUser?.id === id;
      const isAdminUser = !!currentUser?.isAdmin;
      if (!isAdminUser && !isSelf) throw new Error('Não autorizado');
      const toSave = { ...d };
      if (toSave.password) {
        // Senha não é mais armazenada no Firestore — é gerida pelo Firebase Auth.
        if (isSelf) {
          await changeOwnPassword(toSave.password);
        } else {
          throw new Error('Redefinir a senha de outro usuário exige função de servidor (Admin SDK). Peça ao usuário para usar "esqueci minha senha".');
        }
        delete toSave.password;
      }
      if (Object.keys(toSave).length) {
        await updateDoc(doc(db, 'users', id), toSave);
      }
    },
    deleteUser: async (id) => { requireAdmin(); return await deleteDoc(doc(db, 'users', id)); },
    addTeam: async (d) => { 
      requireAdmin(); 
      const normalize = (s) => s?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      const exists = teams.some(t => normalize(t.name) === normalize(d.name));
      if (exists) throw new Error('Já existe um time com esse nome.');
      const r = await addDoc(collection(db, 'teams'), { ...d, createdAt: serverTimestamp() }); 
      return { id: r.id, ...d }; 
    },
    updateTeam: async (id, d) => {
      requireAdmin();
      const existing = teams.find(t => t.id === id);
      if (!existing) throw new Error('Time inexistente');
      const wantsNameChange = typeof d.name === 'string' && d.name.trim() !== existing.name;
      if (wantsNameChange && isTeamProtected(id)) {
        throw new Error('Este time está vinculado a rodadas ativas/fechadas/finalizadas. Alterar o nome não é permitido.');
      }
      return await updateDoc(doc(db, 'teams', id), d);
    },
    deleteTeam: async (id) => {
      requireAdmin();
      if (isTeamProtected(id)) {
        throw new Error('Este time está vinculado a rodadas ativas/fechadas/finalizadas. Exclusão não é permitida.');
      }
      return await deleteDoc(doc(db, 'teams', id));
    },
    deleteAllTeams: async () => {
      requireAdmin();
      const snapshot = await getDocs(collection(db, 'teams'));
      for (const doc of snapshot.docs) {
        await deleteDoc(doc.ref);
      }
    },
    resetTeamsToSerieA2026: async () => {
      requireAdmin();
      const snapshot = await getDocs(collection(db, 'teams'));
      for (const doc of snapshot.docs) {
        await deleteDoc(doc.ref);
      }
      for (const team of SERIE_A_2026_TEAMS) {
        await addDoc(collection(db, 'teams'), { ...team, createdAt: serverTimestamp() });
      }
    },
    submitImportRequestsFromApi: async () => {
      requireAdmin();
      try {
        const r = await axios.get('/api/brasileirao/teams');
        const items = Array.isArray(r.data?.teams) ? r.data.teams : [];
        const normalize = (s) => s?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        const existingNames = new Set(teams.map(t => normalize(t.name)));
        for (const it of items) {
          const nm = normalize(it.name);
          if (!nm || existingNames.has(nm)) continue;
          await addDoc(collection(db, 'team_import_requests'), {
            name: it.name,
            logo: it.logo || '',
            normalizedName: nm,
            status: 'pending',
            createdAt: serverTimestamp(),
          });
        }
      } catch (err) {
        console.error('Erro ao buscar times da API:', err);
        throw new Error('Falha ao buscar times da API');
      }
    },
    approveImportRequest: async (id) => {
      requireAdmin();
      const req = teamImportRequests.find(r => r.id === id);
      if (!req) throw new Error('Solicitação inexistente');
      if (req.status !== 'pending') throw new Error('Solicitação não está pendente');
      const normalize = (s) => s?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      const exists = teams.some(t => normalize(t.name) === (req.normalizedName || normalize(req.name)));
      if (exists) throw new Error('Já existe um time com esse nome');
      const teamDoc = await addDoc(collection(db, 'teams'), { name: req.name, logo: req.logo || '', createdAt: serverTimestamp() });
      await updateDoc(doc(db, 'team_import_requests', id), { status: 'approved', approvedAt: serverTimestamp(), approvedTeamId: teamDoc.id });
      await addDoc(collection(db, 'audit_logs'), { type: 'team_import_approved', requestId: id, teamId: teamDoc.id, actorId: currentUser?.id || null, at: serverTimestamp() });
    },
    rejectImportRequest: async (id, reason) => {
      requireAdmin();
      const req = teamImportRequests.find(r => r.id === id);
      if (!req) throw new Error('Solicitação inexistente');
      if (req.status !== 'pending') throw new Error('Solicitação não está pendente');
      await updateDoc(doc(db, 'team_import_requests', id), { status: 'rejected', rejectedAt: serverTimestamp(), reason: reason || '' });
      await addDoc(collection(db, 'audit_logs'), { type: 'team_import_rejected', requestId: id, actorId: currentUser?.id || null, reason: reason || '', at: serverTimestamp() });
    },
    addRound: async (d) => { requireAdmin(); const r = await addDoc(collection(db, 'rounds'), { ...d, createdAt: serverTimestamp() }); return { id: r.id, ...d }; },
    updateRound: async (id, d) => { requireAdmin(); return await updateDoc(doc(db, 'rounds', id), d); },
    deleteRound: async (id) => { requireAdmin(); return await deleteDoc(doc(db, 'rounds', id)); },
    addPrediction: async (d) => { 
      if (!currentUser) throw new Error('Não autenticado');
      if (currentUser.id !== d.userId && !currentUser.isAdmin) throw new Error('Não autorizado');
      const r = await addDoc(collection(db, 'predictions'), { 
        ...d, 
        paid: false, 
        cartelaCode: d.cartelaCode || generateCartelaCode(),
        createdAt: serverTimestamp() 
      }); 
      return { id: r.id, ...d }; 
    },
    updatePrediction: async (id, d) => {
      const existing = predictions.find(p => p.id === id);
      if (!existing) throw new Error('Palpite inexistente');
      if (existing.userId !== currentUser?.id && !currentUser?.isAdmin) throw new Error('Não autorizado');
      return await updateDoc(doc(db, 'predictions', id), d);
    },
    deleteCartelaPredictions: async (userId, roundId, cartelaCode) => {
      if (!currentUser) throw new Error('Não autenticado');
      if (currentUser.id !== userId && !currentUser.isAdmin) throw new Error('Não autorizado');
      try {
        const toDelete = predictions.filter(p => 
          p.userId === userId && 
          p.roundId === roundId && 
          (p.cartelaCode || 'ANTIGA') === cartelaCode &&
          !p.paid
        );
        for (const pred of toDelete) {
          await deleteDoc(doc(db, 'predictions', pred.id));
        }
      } catch (err) {
        console.error('Erro ao excluir cartela:', err);
        throw err;
      }
    },
    addEstablishment: async (d) => { requireAdmin(); const r = await addDoc(collection(db, 'establishments'), { ...d, createdAt: serverTimestamp() }); return { id: r.id, ...d }; },
    updateEstablishment: async (id, d) => { requireAdmin(); return await updateDoc(doc(db, 'establishments', id), d); },
    deleteEstablishment: async (id) => { requireAdmin(); return await deleteDoc(doc(db, 'establishments', id)); },
    updateSettings: async (d) => {
      requireAdmin();
      if (settings?.id) {
        console.log('Atualizando settings com ID:', settings.id, 'Dados:', d);
        await updateDoc(doc(db, 'settings', settings.id), d);
        console.log('Settings atualizado com sucesso');
      } else {
        console.error('Settings ID não encontrado');
        throw new Error('Configurações não inicializadas');
      }
    },
    addCommunication: async (d) => { requireAdmin(); const r = await addDoc(collection(db, 'communications'), { ...d, createdAt: serverTimestamp() }); return { id: r.id, ...d }; },
    updateCommunication: async (id, d) => { requireAdmin(); return await updateDoc(doc(db, 'communications', id), d); }
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

// Utilitário simples de Markdown -> HTML (negrito, itálico, listas)
// Componente reutilizável: Regras do Bolão
const RulesCard = () => {
  const { settings } = useApp();
  const betValue = settings?.betValue != null ? settings.betValue.toFixed(2) : '15,00';

  const hasCustomRules = settings?.rulesText || settings?.scoringCriteria || settings?.tiebreakRules;

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6">
      <div className="flex items-center gap-2 mb-4">
        <FileText size={20} className="text-green-600" />
        <h2 className="text-xl font-bold">Regras do Bolão</h2>
      </div>

      {hasCustomRules ? (
        <div className="space-y-6">
          {settings?.rulesText && (
            <div className="space-y-2">
              <h3 className="font-semibold text-gray-900">Texto Completo</h3>
              <div className="text-gray-700 text-sm" dangerouslySetInnerHTML={{ __html: markdownToHtml(settings.rulesText) }} />
            </div>
          )}
          {settings?.scoringCriteria && (
            <div className="space-y-2">
              <h3 className="font-semibold text-gray-900">Critérios de Pontuação</h3>
              <div className="text-gray-700 text-sm" dangerouslySetInnerHTML={{ __html: markdownToHtml(settings.scoringCriteria) }} />
            </div>
          )}
          {settings?.tiebreakRules && (
            <div className="space-y-2">
              <h3 className="font-semibold text-gray-900">Regras de Desempate</h3>
              <div className="text-gray-700 text-sm" dangerouslySetInnerHTML={{ __html: markdownToHtml(settings.tiebreakRules) }} />
            </div>
          )}
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
            Valor por cartela: R$ {betValue}
          </div>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-900">Participação</h3>
            <ul className="list-disc list-inside text-gray-700 space-y-1">
              <li>Faça seus palpites antes do início das partidas.</li>
              <li>Valor por cartela: R$ {betValue}.</li>
              <li>Somente cartelas pagas entram no ranking e na premiação.</li>
            </ul>
          </div>
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-900">Pontuação</h3>
            <ul className="list-disc list-inside text-gray-700 space-y-1">
              <li>Placar exato: 3 pontos.</li>
              <li>Resultado correto (vitória/empate): 1 ponto.</li>
            </ul>
          </div>
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-900">Premiação</h3>
            <ul className="list-disc list-inside text-gray-700 space-y-1">
              <li>85% do total pago na rodada compõe o prêmio.</li>
              <li>Dividido igualmente entre os vencedores com maior pontuação.</li>
            </ul>
          </div>
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-900">Desempate</h3>
            <ul className="list-disc list-inside text-gray-700 space-y-1">
              <li>Posição igual para empates em pontos.</li>
              <li>Premiação dividida igualmente entre empatados no topo.</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

// Reutilizável em todos os headers — alterna modo escuro/claro
const DarkToggle = ({ variant = 'dark' }) => {
  const { darkMode, toggleDark } = useApp();
  // variant 'dark': usado em headers escuros (sidebar, scoreboard)
  // variant 'light': usado em headers claros (topbar branco, formulários)
  const cls = variant === 'light'
    ? 'text-noite-400 hover:text-noite-700 hover:bg-gray-100 dark:text-yellow-400 dark:hover:bg-white/10'
    : 'text-white/50 hover:text-white hover:bg-white/10';
  return (
    <button
      onClick={toggleDark}
      title={darkMode ? 'Modo claro' : 'Modo noturno'}
      aria-label="Alternar modo noturno"
      className={`p-2.5 rounded-xl transition-all duration-200 flex-shrink-0 ${cls}`}
    >
      {darkMode ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
};

const LoginScreen = ({ setView }) => {
  const { users, login, addUser, updateUser, settings, establishments } = useApp();
  const [whatsapp, setWhatsapp] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [showRegister, setShowRegister] = useState(false);
  const [reg, setReg] = useState({ name: '', whatsapp: '', password: '', confirmPassword: '', establishmentId: '' });
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [showForgot, setShowForgot] = useState(false);

  const normalizeWhatsapp = (s) => {
    const d = (s || '').replace(/\D/g, '');
    // Brasil: use os últimos 11 dígitos (DDD + número), removendo código do país se presente
    return d.length > 11 ? d.slice(-11) : d;
  };

  const handleLogin = async () => {
    const phone = normalizeWhatsapp(whatsapp);
    if (!phone || !password) { setError('Informe WhatsApp e senha'); return; }
    let user = null;
    try {
      user = await loginWithWhatsapp(phone, password);
    } catch (err) {
      setError(authErrorMessage(err));
      return;
    }
    // Define currentUser imediatamente (o observer de Auth confirma em seguida).
    login(user);
    // Se manutenção ativa e o usuário não é admin, redireciona para tela de manutenção.
    if (settings?.maintenanceMode && !user.isAdmin) {
      setView('maintenance');
      setError('');
      return;
    }
    setView(user.isAdmin ? 'admin' : 'user');
    setError('');
  };

  const handleRegister = async () => {
    if (settings?.maintenanceMode) {
      setError('Cadastro temporariamente indisponível durante a manutenção.');
      return;
    }
    if (!reg.name || !reg.whatsapp || !reg.password) return setError('Preencha todos!');
    if (reg.password !== reg.confirmPassword) return setError('Senhas diferentes!');
    if (reg.password.length < 6) return setError('Senha mínimo 6!');
    const phone = normalizeWhatsapp(reg.whatsapp);
    if (users.find(u => normalizeWhatsapp(u.whatsapp) === phone)) return setError('WhatsApp já cadastrado!');
    try {
      await addUser({ name: reg.name, whatsapp: phone, password: reg.password, isAdmin: false, balance: 0, establishmentId: reg.establishmentId || null });
      alert('✅ Cadastrado! Faça login para entrar.');
      setShowRegister(false);
      setWhatsapp(phone);
      setReg({ name: '', whatsapp: '', password: '', confirmPassword: '', establishmentId: '' });
      setError('');
    } catch (e) {
      setError(authErrorMessage(e));
    }
  };

  if (showRegister) {
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
            <p className="text-campo-400 text-xs font-semibold uppercase mb-5" style={{ letterSpacing: '0.25em' }}>Nova conta</p>
            <h2 className="font-display text-white leading-none" style={{ fontSize: 'clamp(56px, 8vw, 88px)' }}>
              JUNTE-SE<br />
              <span className="text-ouro-500">AO BOLÃO</span>
            </h2>
            <p className="text-noite-500 text-sm mt-6 max-w-xs leading-relaxed font-medium">
              Faça seus palpites, dispute com amigos e concorra a prêmios em cada rodada do Brasileirão 2026.
            </p>
          </div>
          <div className="flex gap-1.5">
            <div className="h-1 flex-1 bg-campo-600 rounded-full" />
            <div className="h-1 flex-1 bg-ouro-500 rounded-full" />
            <div className="h-1 flex-[2] bg-white/10 rounded-full" />
          </div>
        </div>

        {/* ── Right: form ── */}
        <div className="flex-1 bg-white dark:bg-[#0C1C10] flex items-center justify-center p-6 sm:p-10 min-h-screen relative">
          <div className="absolute top-4 right-4">
            <DarkToggle variant="light" />
          </div>
          <div className="w-full max-w-md animate-slide-up">
            {/* Mobile logo */}
            <div className="flex lg:hidden items-center gap-2 mb-8">
              <div className="w-8 h-8 bg-campo-600 rounded-lg flex items-center justify-center">
                <Trophy size={14} className="text-ouro-500" />
              </div>
              <span className="font-display text-noite-900 text-base" style={{ letterSpacing: '0.2em' }}>BOLÃO BRASILEIRÃO</span>
            </div>
            <div className="mb-7">
              <h2 className="font-display text-4xl text-noite-900" style={{ letterSpacing: '0.04em' }}>CRIAR CONTA</h2>
              <p className="text-noite-400 text-sm mt-1.5">Preencha os dados para participar do bolão</p>
            </div>
            {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-5 text-sm animate-bounce-in">{error}</div>}
            <div className="space-y-4">
              <div>
                <label className="v2-label">Nome</label>
                <input type="text" placeholder="Seu nome completo" value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} className="v2-input" />
              </div>
              <div>
                <label className="v2-label">WhatsApp</label>
                <input type="tel" placeholder="11999999999" value={reg.whatsapp} onChange={(e) => setReg({ ...reg, whatsapp: e.target.value.replace(/\D/g, '') })} className="v2-input" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="v2-label">Senha</label>
                  <input type="password" placeholder="Mín. 6 caracteres" value={reg.password} onChange={(e) => setReg({ ...reg, password: e.target.value })} className="v2-input" />
                </div>
                <div>
                  <label className="v2-label">Confirmar</label>
                  <input type="password" placeholder="Repita a senha" value={reg.confirmPassword} onChange={(e) => setReg({ ...reg, confirmPassword: e.target.value })} className="v2-input" />
                </div>
              </div>
              {establishments.length > 0 && (
                <div>
                  <label className="v2-label">Estabelecimento</label>
                  <select value={reg.establishmentId} onChange={(e) => setReg({ ...reg, establishmentId: e.target.value })} className="v2-input">
                    <option value="">Nenhum (participação direta)</option>
                    {establishments.map(est => <option key={est.id} value={est.id}>{est.name}</option>)}
                  </select>
                </div>
              )}
              <div className="pt-2 space-y-3">
                <button onClick={handleRegister} className="v2-btn-primary w-full py-3.5 text-base">Criar Conta</button>
                <button onClick={() => { setShowRegister(false); setError(''); }} className="v2-btn-outline w-full py-3">Já tenho conta</button>
                <button onClick={() => setShowRulesModal(true)} className="v2-btn-ghost w-full py-2.5 text-sm">
                  <FileText size={16} /> Ver Regras
                </button>
              </div>
            </div>
          </div>
        </div>

        {showRulesModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
            <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-modal animate-slide-up">
              <div className="p-6 border-b flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <FileText className="text-campo-600" size={24} />
                  <h3 className="font-display text-2xl text-noite-900" style={{ letterSpacing: '0.04em' }}>REGRAS DO BOLÃO</h3>
                </div>
                <button onClick={() => setShowRulesModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={24} /></button>
              </div>
              <div className="p-6"><RulesCard /></div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen font-body flex flex-col lg:flex-row">
      {/* ── Left: hero panel ── */}
      <div className="login-hero hidden lg:flex lg:w-5/12 xl:w-1/2 flex-col relative overflow-hidden p-10 xl:p-14 min-h-screen">
        <div className="absolute top-0 right-0 w-px h-full bg-gradient-to-b from-transparent via-ouro-500/40 to-transparent pointer-events-none" />
        <div className="flex items-center gap-3 mb-auto">
          <div className="w-9 h-9 bg-campo-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <Trophy size={17} className="text-ouro-500" />
          </div>
          <span className="font-display text-white text-base" style={{ letterSpacing: '0.2em' }}>BOLÃO BRASILEIRÃO</span>
        </div>
        <div className="flex-1 flex flex-col justify-center py-12">
          <p className="text-campo-400 text-xs font-semibold uppercase mb-5" style={{ letterSpacing: '0.28em' }}>Campeonato Brasileiro</p>
          <h1 className="font-display leading-none">
            <span className="block text-white" style={{ fontSize: 'clamp(72px, 10vw, 120px)' }}>BOLÃO</span>
            <span className="block text-ouro-500" style={{ fontSize: 'clamp(48px, 7vw, 80px)' }}>BRASILEIRÃO</span>
            <span className="block text-noite-600" style={{ fontSize: 'clamp(28px, 4vw, 44px)', marginTop: '4px' }}>2026 — SÉRIE A</span>
          </h1>
          <p className="text-noite-500 text-sm mt-8 max-w-xs leading-relaxed font-medium">
            Faça seus palpites rodada a rodada e concorra a prêmios. A maior competição de bolão do futebol brasileiro.
          </p>
        </div>
        <div className="flex gap-1.5">
          <div className="h-1 flex-1 bg-campo-600 rounded-full" />
          <div className="h-1 flex-1 bg-ouro-500 rounded-full" />
          <div className="h-1 flex-[2] bg-white/10 rounded-full" />
        </div>
      </div>

      {/* ── Right: form ── */}
      <div className="flex-1 bg-white dark:bg-[#0C1C10] flex items-center justify-center p-6 sm:p-10 min-h-screen relative">
        <div className="absolute top-4 right-4">
          <DarkToggle variant="light" />
        </div>
        <div className="w-full max-w-sm animate-fade-in">
          {/* Mobile logo */}
          <div className="flex lg:hidden items-center gap-2 mb-8">
            <div className="w-8 h-8 bg-campo-600 rounded-lg flex items-center justify-center">
              <Trophy size={14} className="text-ouro-500" />
            </div>
            <span className="font-display text-noite-900 text-base" style={{ letterSpacing: '0.2em' }}>BOLÃO BRASILEIRÃO</span>
          </div>

          <div className="mb-8">
            <h2 className="font-display text-5xl text-noite-900" style={{ letterSpacing: '0.04em' }}>ENTRAR</h2>
            <p className="text-noite-400 text-sm mt-1.5">Acesse sua conta para fazer seus palpites</p>
          </div>

          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-5 text-sm animate-bounce-in">{error}</div>}

          <div className="space-y-4">
            <div>
              <label className="v2-label">WhatsApp</label>
              <input type="tel" placeholder="11999999999" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className="v2-input" />
            </div>
            <div>
              <label className="v2-label">Senha</label>
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && handleLogin()} className="v2-input pr-12" />
                <button onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-noite-400 hover:text-noite-700 transition-colors">
                  {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                </button>
              </div>
            </div>
            <div className="pt-2 space-y-3">
              <button onClick={handleLogin} className="v2-btn-primary w-full py-3.5 text-base">Entrar</button>
              <button onClick={() => { setError(''); setShowForgot(true); }} className="v2-btn-ghost w-full py-2 text-sm">
                Esqueci minha senha
              </button>
              <button onClick={() => { setShowRegister(true); setError(''); }} className="v2-btn-outline w-full py-3">
                <UserPlus size={18} /> Criar Conta
              </button>
              <button onClick={() => setShowRulesModal(true)} className="v2-btn-ghost w-full py-2.5 text-sm">
                <FileText size={16} /> Ver Regras
              </button>
            </div>
          </div>
        </div>
      </div>

      {showRulesModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-3xl w-full shadow-modal animate-slide-up">
            <div className="p-6 border-b flex justify-between items-center">
              <div className="flex items-center gap-3">
                <FileText className="text-campo-600" size={24} />
                <h3 className="font-display text-2xl text-noite-900" style={{ letterSpacing: '0.04em' }}>REGRAS DO BOLÃO</h3>
              </div>
              <button onClick={() => setShowRulesModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={24} /></button>
            </div>
            <div className="p-6"><RulesCard /></div>
          </div>
        </div>
      )}
      {showForgot && (
        <ForgotPasswordModal initialWhatsapp={whatsapp} onClose={() => setShowForgot(false)} />
      )}
    </div>
  );
};

const ForgotPasswordModal = ({ initialWhatsapp, onClose }) => {
  const [phone, setPhone] = useState(initialWhatsapp || '');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length < 10) { setError('Digite um WhatsApp válido (com DDD)'); return; }
    setError(''); setLoading(true);
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ whatsapp: digits })
      });
      // Resposta genérica (não revela se o número existe).
      setDone(true);
    } catch {
      setError('Não foi possível processar agora. Tente novamente em instantes.');
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
            <h3 className="font-display text-xl text-noite-900" style={{ letterSpacing: '0.04em' }}>REDEFINIR SENHA</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={24} /></button>
        </div>
        {done ? (
          <div className="p-6 space-y-4 text-center">
            <CheckCircle className="text-green-600 mx-auto" size={40} />
            <p className="text-noite-700">Se este WhatsApp estiver cadastrado, você receberá uma <strong>senha temporária</strong> por mensagem. Verifique seu WhatsApp e faça login com ela.</p>
            <button onClick={onClose} className="v2-btn-primary w-full py-3">Entendi</button>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            <p className="text-sm text-noite-500">Informe o WhatsApp cadastrado. Enviaremos uma senha temporária por mensagem. Confirme abaixo para prosseguir.</p>
            <div>
              <label className="v2-label">WhatsApp</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleConfirm()}
                placeholder="(DDD) número"
                className="v2-input"
                autoFocus
              />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="flex gap-3 pt-1">
              <button onClick={onClose} className="v2-btn-outline flex-1 py-3">Cancelar</button>
              <button onClick={handleConfirm} disabled={loading} className="v2-btn-primary flex-1 py-3 disabled:opacity-60">
                {loading ? 'Enviando...' : 'Redefinir senha'}
              </button>
            </div>
          </div>
        )}
      </div>
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
    if (!formData.name || !formData.logo) {
      alert('Preencha todos os campos!');
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
            <label className="block text-sm font-medium mb-2">Logo</label>
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
      matches: [...(formData.matches || []), { id: Date.now(), homeTeamId: teams[0]?.id, awayTeamId: teams[1]?.id, date: '', homeScore: null, awayScore: null, finished: false }]
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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b sticky top-0 bg-white">
          <h3 className="text-2xl font-bold">{round ? 'Editar Rodada' : 'Nova Rodada'}</h3>
        </div>
        <div className="p-6 space-y-6">
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
    if (!newPassword || newPassword.length < 6) {
      setError('Senha deve ter no mínimo 6 caracteres!');
      return;
    }
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
          <div>
            <label className="block text-sm font-medium mb-2">Nova Senha</label>
            <div className="relative">
              <input 
                type={showPassword ? 'text' : 'password'} 
                value={newPassword} 
                onChange={(e) => setNewPassword(e.target.value)} 
                className="w-full px-4 py-2 border rounded-lg" 
                placeholder="Mínimo 6 caracteres" 
              />
              <button 
                onClick={() => setShowPassword(!showPassword)} 
                className="absolute right-3 top-1/2 transform -translate-y-1/2"
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Confirmar Senha</label>
            <input 
              type={showPassword ? 'text' : 'password'} 
              value={confirmPassword} 
              onChange={(e) => setConfirmPassword(e.target.value)} 
              className="w-full px-4 py-2 border rounded-lg" 
              placeholder="Digite novamente" 
            />
          </div>
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
  const { currentUser, setCurrentUser, logout, teams, rounds, users, predictions, establishments, settings, communications, addRound, updateRound, deleteRound, addTeam, updateTeam, deleteTeam, updateUser, deleteUser, resetTeamsToSerieA2026, updatePrediction, updateSettings, addEstablishment, updateEstablishment, deleteEstablishment, addCommunication, updateCommunication, teamImportRequests, submitImportRequestsFromApi, approveImportRequest, rejectImportRequest } = useApp();
  
  console.log('AdminPanel - Settings:', settings);
  
  const [activeTab, setActiveTab] = useState('financial');
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
  const [appUrl, setAppUrl] = useState(settings?.appUrl || (typeof window !== 'undefined' ? window.location.origin : ''));
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
        const q = query(collection(db, 'settings_history'), orderBy('createdAt', 'desc'), limit(10));
        const snap = await getDocs(q);
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setSettingsHistory(items);
      } catch (err) {
        console.warn('Falha ao carregar histórico:', err);
      }
    };
    loadHistory();
  }, [settings]);

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
      const userPredictions = predictions.filter(p => p.userId === user.id);
      for (const pred of userPredictions) {
        await deleteDoc(doc(db, 'predictions', pred.id));
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
      
      for (const pred of cartelaPredictions) {
        await updatePrediction(pred.id, { paid: newPaidStatus });
      }

      try {
        await addDoc(collection(db, 'admin_events'), {
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
    
    // Premiação e Admin são sobre o TOTAL
    const prizePool = totalReceivedAll * 0.85;
    const adminFee = totalReceivedAll * 0.10;
    
    // Comissão do estabelecimento: 5% APENAS dos palpites vinculados a ele
    let establishmentFee = 0;
    if (filterEstablishmentId && filterEstablishmentId !== 'all' && filterEstablishmentId !== 'none') {
      // Se filtrou um estabelecimento específico, mostrar só a comissão dele
      const estParticipants = allParticipants.filter(p => p.establishmentId === filterEstablishmentId && p.paid);
      establishmentFee = estParticipants.length * betValue * 0.05;
    } else {
      // Se não filtrou ou filtrou "todos", somar comissões de TODOS os estabelecimentos
      const paidParticipants = allParticipants.filter(p => p.paid);
      establishmentFee = paidParticipants.reduce((sum, p) => {
        return p.establishmentId ? sum + (betValue * 0.05) : sum;
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

    const prizePool = totalReceived * 0.85;
    const adminFee = totalReceived * 0.10;
    
    // Calcular comissão total somando todas as rodadas
    let establishmentFee = 0;
    finishedAndClosedRounds.forEach(round => {
      const participants = getRoundParticipants(round.id).filter(p => p.paid);
      establishmentFee += participants.reduce((sum, p) => {
        return p.establishmentId ? sum + (betValue * 0.05) : sum;
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
    const prizePool = totalPaid * 0.85;
    const adminFee = totalPaid * 0.10;
    
    // Calcular comissão total dos estabelecimentos (soma individual)
    const establishmentFee = paidParticipations.reduce((sum, p) => {
      return p.establishmentId ? sum + (betValue * 0.05) : sum;
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
      
      let points = 0;
      round.matches?.forEach(match => {
        const pred = cartelaPreds.find(p => p.matchId === match.id);
        
        // Conta pontos se houver placar disponível — inclusive parcial (jogo em andamento).
        // Para rodadas finalizadas, todos os matches têm finished=true, sem diferença.
        if (pred && match.homeScore !== null && match.awayScore !== null) {
          if (pred.homeScore === match.homeScore && pred.awayScore === match.awayScore) {
            points += 3;
          } else {
            const predResult = pred.homeScore > pred.awayScore ? 'home' : pred.homeScore < pred.awayScore ? 'away' : 'draw';
            const matchResult = match.homeScore > match.awayScore ? 'home' : match.homeScore < match.awayScore ? 'away' : 'draw';
            if (predResult === matchResult) {
              points += 1;
            }
          }
        }
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
        appUrl: (appUrl || '').trim(),
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
      const settingsSnapshot = await getDocs(collection(db, 'settings'));
      let settingsId = null;
      if (settingsSnapshot.empty) {
        const docRef = await addDoc(collection(db, 'settings'), { ...dataToSave, createdAt: serverTimestamp() });
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
      const roundsSnap = await getDocs(collection(db, 'rounds'));
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
      const predsSnap = await getDocs(collection(db, 'predictions'));
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
                  <span>{round.matches?.length || 0} jogos</span>
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
              {[...(round.matches || [])].sort(sortMatchesByDate).map((match) => {
                const homeTeam = teams.find(t => t.id === match.homeTeamId);
                const awayTeam = teams.find(t => t.id === match.awayTeamId);
                const homeName = homeTeam?.name || match.homeTeamName || '?';
                const awayName = awayTeam?.name || match.awayTeamName || '?';
                return (
                  <div key={match.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
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
                    {match.date && (
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
  ];
  const activeTabLabel = adminTabMeta.find(t => t.id === activeTab)?.label || '';

  return (
    <div className="min-h-screen font-body flex page-bg">

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
                <h2 className="text-2xl font-bold">Estabelecimentos/Indicadores</h2>
                <p className="text-gray-600 mt-1">Gerenciar locais que indicam participantes • Comissão: 5%</p>
              </div>
              <button onClick={() => { setEditingEstablishment(null); setShowEstablishmentForm(true); }} className="w-full sm:w-auto flex items-center justify-center gap-2 bg-green-600 text-white px-5 py-2.5 rounded-lg text-sm sm:text-base">
                <Plus size={20} /> Novo Estabelecimento
              </button>
            </div>
            {establishments.length === 0 ? (
              <div className="bg-white rounded-xl p-12 text-center border-2 border-dashed">
                <Store className="mx-auto text-gray-400 mb-4" size={48} />
                <h3 className="text-xl font-semibold mb-2">Nenhum estabelecimento cadastrado</h3>
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
                  { key: 'integracoes', label: 'Integrações', icon: Key },
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


            {/* Integrações */}
            {settingsTab === 'integracoes' && (
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
                  <div>
                    <label className="block text-sm font-medium mb-1">URL pública da app</label>
                    <input type="url" value={appUrl} onChange={e => setAppUrl(e.target.value)} placeholder="https://seu-sistema.vercel.app" className="w-full px-3 py-2 border rounded-lg text-sm" />
                    <p className="text-xs text-gray-400 mt-1">Usada para gerar o link do ranking no WhatsApp quando o PDF não puder ser enviado. Salve para ativar.</p>
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
                      const res = await fetch('/api/cron/sync-rounds', { method: 'POST' });
                      const data = await res.json();
                      alert('Sync concluído!\n\n' + (data.logs || []).join('\n'));
                    } catch (e) {
                      alert('Erro ao sincronizar: ' + e.message);
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
                  <Plus size={20} /> Nova Rodada
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
              <button onClick={handleFixUserDuplicates} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm sm:text-base w-full sm:w-auto justify-center">
                <CheckCircle size={20} /> Corrigir duplicados
              </button>
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

const UserPanel = ({ setView }) => {
  const { currentUser, setCurrentUser, logout, teams, rounds, predictions, users, establishments, addPrediction, settings, deleteCartelaPredictions, updateUser } = useApp();
  const [activeTab, setActiveTab] = useState('predictions');
  const [selectedRound, setSelectedRound] = useState(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingPredictions, setPendingPredictions] = useState(null);
  const [expandedRounds, setExpandedRounds] = useState({});
  const [selectedRankingRound, setSelectedRankingRound] = useState(null);
  const [editingPredictions, setEditingPredictions] = useState(null);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [cartelaDetails, setCartelaDetails] = useState(null);
  // Estados para a aba "Rodadas Finalizadas"
  const [selectedFinishedRound, setSelectedFinishedRound] = useState(null);
  const [finishedStartDate, setFinishedStartDate] = useState('');
  const [finishedEndDate, setFinishedEndDate] = useState('');
  const [finishedPeriod, setFinishedPeriod] = useState('all'); // all | 3m | 6m | 12m
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentContext, setPaymentContext] = useState(null);
  const [paymentLocks, setPaymentLocks] = useState({});
  const [showChangePassword, setShowChangePassword] = useState(false);

  // Deep-link para ranking: ?view=user&tab=ranking&round=<id>
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      const params = new URLSearchParams(window.location.search);
      const tab = params.get('tab');
      const roundId = params.get('round');
      if (tab === 'ranking') setActiveTab('ranking');
      if (roundId) setSelectedRankingRound(roundId);
    } catch {}
  }, []);

  const toggleRound = (roundId) => {
    setExpandedRounds(prev => ({ ...prev, [roundId]: !prev[roundId] }));
  };

  // Helper local para fechar rodada por horário, compartilhando a mesma regra do Admin
  const isRoundTimedClosed = (round) => {
    if (!round?.closeAt) return false;
    const ts = new Date(round.closeAt).getTime();
    return !isNaN(ts) && Date.now() >= ts;
  };

  // Helper local de formatação de data/hora (pt-BR)
  const formatDateTime = (value) => {
    if (!value) return null;
    const dt = new Date(value);
    if (isNaN(dt.getTime())) return null;
    return dt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
  };

  const openRounds = rounds.filter(r => r.status === 'open' && !isRoundTimedClosed(r));
  const closedRounds = rounds.filter(r => r.status === 'closed' || (r.status === 'open' && isRoundTimedClosed(r))).sort((a, b) => b.number - a.number);
  const finishedRounds = rounds.filter(r => r.status === 'finished').sort((a, b) => b.number - a.number);
  const rankableRounds = rounds
    .filter(r => r.status === 'finished' || r.status === 'closed')
    .sort((a, b) => (b.number || 0) - (a.number || 0));
  const upcomingRounds = rounds.filter(r => r.status === 'upcoming').sort((a, b) => a.number - b.number);
  const openRoundsForBetting = rounds
    .filter(r => r.status === 'open' && !isRoundTimedClosed(r))
    .sort((a, b) => a.number - b.number);
  const upcomingRoundsForView = rounds
    .filter(r => r.status === 'upcoming')
    .sort((a, b) => a.number - b.number);

  // Rodadas fechadas com pelo menos um jogo com placar disponível (em andamento ou finalizado)
  const closedRoundsActive = closedRounds.filter(r =>
    r.matches?.some(m => m.homeScore !== null && m.awayScore !== null)
  );

  // Minhas rodadas: apenas as que o usuário está participando
  const myRoundIds = new Set(
    predictions
      .filter(p => p.userId === currentUser.id)
      .map(p => p.roundId)
  );
  const myOpenOrUpcomingRounds = rounds
    .filter(r => myRoundIds.has(r.id) && (r.status === 'open' || r.status === 'upcoming') && !isRoundTimedClosed(r))
    .sort((a, b) => a.number - b.number);
  const myClosedRounds = rounds
    .filter(r => myRoundIds.has(r.id) && (r.status === 'closed' || (r.status === 'open' && isRoundTimedClosed(r))))
    .sort((a, b) => b.number - a.number);
  const myFinishedRounds = rounds
    .filter(r => myRoundIds.has(r.id) && r.status === 'finished')
    .sort((a, b) => b.number - a.number);

  useEffect(() => {
    if (rankableRounds.length > 0) {
      const latestRound = rankableRounds[0];
      if (selectedRankingRound !== latestRound.id) {
        setSelectedRankingRound(latestRound.id);
      }
    }
  }, [rankableRounds]);

  const getRoundPredictions = (roundId) => {
    return predictions.filter(p => p.userId === currentUser.id && p.roundId === roundId);
  };

  const getUserCartelasForRound = (roundId) => {
    const userPreds = predictions.filter(p => p.userId === currentUser.id && p.roundId === roundId);
    const cartelaMap = {};
    
    userPreds.forEach(pred => {
      const code = pred.cartelaCode || 'ANTIGA';
      if (!cartelaMap[code]) {
        cartelaMap[code] = {
          code,
          predictions: [],
          paid: pred.paid || false,
          establishmentId: pred.establishmentId
        };
      }
      cartelaMap[code].predictions.push(pred);
    });
    
    return Object.values(cartelaMap);
  };

  // Abrir detalhes da cartela a partir de uma linha do ranking
  const openRankingCartelaDetails = (roundId, item) => {
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
    setCartelaDetails({ round, cartela });
  };

  const calculateRoundPoints = (roundId) => {
    const round = rounds.find(r => r.id === roundId);
    if (!round) return null;
    const canScore = round.status === 'finished' || round.status === 'closed' || isRoundTimedClosed(round);
    if (!canScore) return null;
    
    const cartelas = getUserCartelasForRound(roundId);
    const cartelaPoints = {};
    
    cartelas.forEach(cartela => {
      if (!cartela.paid) {
        cartelaPoints[cartela.code] = 0;
        return;
      }
      
      let points = 0;
      round.matches?.forEach(match => {
        const pred = cartela.predictions.find(p => p.matchId === match.id);
        
        if (pred && match.finished && match.homeScore !== null && match.awayScore !== null) {
          if (pred.homeScore === match.homeScore && pred.awayScore === match.awayScore) {
            points += 3;
          } else {
            const predResult = pred.homeScore > pred.awayScore ? 'home' : pred.homeScore < pred.awayScore ? 'away' : 'draw';
            const matchResult = match.homeScore > match.awayScore ? 'home' : match.homeScore < match.awayScore ? 'away' : 'draw';
            if (predResult === matchResult) {
              points += 1;
            }
          }
        }
      });
      cartelaPoints[cartela.code] = points;
    });
    
    return cartelaPoints;
  };

  const handleStartPrediction = (round) => {
    // Bloqueio automático por fechamento programado
    if (isRoundTimedClosed(round)) {
      alert('Rodada fechada para palpites pelo cronograma definido.');
      return;
    }
    setSelectedRound(round);
  };

  const handleDeleteCartela = async (roundId, cartelaCode) => {
    const confirmed = window.confirm('Excluir palpites desta cartela pendente? Esta ação não pode ser desfeita.');
    if (!confirmed) return;
    try {
      await deleteCartelaPredictions(currentUser.id, roundId, cartelaCode);
    } catch (err) {
      alert('Erro ao excluir cartela: ' + err.message);
    }
  };



  const RoundAccordion = ({ round }) => {
    const isExpanded = expandedRounds[round.id];
    const userCartelas = getUserCartelasForRound(round.id);
    const hasPredictions = userCartelas.length > 0;
    const points = calculateRoundPoints(round.id);
    const timedClosed = isRoundTimedClosed(round);
    const isOpenOrUpcoming = round.status === 'open' || round.status === 'upcoming';
    const canPredictNoExisting = round.status === 'open' && !timedClosed && !hasPredictions;
    const isUpcomingViewOnly = round.status === 'upcoming' && !hasPredictions;
    const isTimedClosedOpenOrUpcoming = isOpenOrUpcoming && timedClosed;
    const totalMatches = round.matches?.length || 0;
    const finishedMatchesCount = round.matches?.filter(m => m.finished && m.homeScore !== null && m.awayScore !== null).length || 0;
    const hasAnyFinished = finishedMatchesCount > 0;
    const progressPercent = totalMatches ? Math.round((finishedMatchesCount / totalMatches) * 100) : 0;
    
    const getStatusInfo = () => {
      const effStatus = (round.status === 'open' && timedClosed) ? 'closed' : round.status;
      switch (effStatus) {
        case 'upcoming':
          return { text: 'Futura', color: 'bg-gray-100 text-gray-700', icon: '🔜' };
        case 'open':
          return { text: hasPredictions ? 'Palpites Feitos' : 'Aberta', color: hasPredictions ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700', icon: hasPredictions ? '✅' : '⏰' };
        case 'closed':
          return { text: 'Aguardando', color: 'bg-yellow-100 text-yellow-700', icon: '🔒' };
        case 'finished':
          return { text: 'Finalizada', color: 'bg-purple-100 text-purple-700', icon: '🏁' };
        default:
          return { text: 'Status', color: 'bg-gray-100 text-gray-700', icon: '❓' };
      }
    };

    const status = getStatusInfo();
    const totalPoints = points ? Object.values(points).reduce((a, b) => a + b, 0) : 0;

    return (
      <div className="rounded-xl shadow-sm border overflow-hidden" style={{ backgroundColor: 'var(--bg-card)', color: 'var(--txt-1)' }}>
        <button
          onClick={() => toggleRound(round.id)}
          className="w-full p-6 flex items-center justify-between transition"
          style={{ backgroundColor: 'transparent', color: 'inherit' }}
          onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-raised)'}
          onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
        >
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-xl ${status.color}`}>
              {round.number}
            </div>
            <div className="text-left">
              <h3 className="text-lg font-bold" style={{ color: 'var(--txt-1)' }}>{round.name}</h3>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${status.color}`}>
                  {status.icon} {status.text}
                </span>
                {round.closeAt && (
                  <span className="bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-xs font-medium">
                    Fecha: {formatDateTime(round.closeAt) || round.closeAt}
                  </span>
                )}
                {hasPredictions && (
                  <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-medium">
                    {userCartelas.length} cartela(s)
                  </span>
                )}
                {((round.status === 'finished') || ((round.status === 'closed' || timedClosed) && hasAnyFinished)) && (
                  <span className="bg-green-600 text-white px-3 py-1 rounded-full text-xs font-bold">
                    {totalPoints} pontos total
                  </span>
                )}
                {(round.status === 'closed' || timedClosed) && hasAnyFinished && (
                  <span className="bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full text-xs font-medium">
                    Parcial
                  </span>
                )}
                {(round.status === 'finished' || round.status === 'closed' || timedClosed) && totalMatches > 0 && (
                  <span className="flex items-center gap-2 ml-2">
                    <span className="w-28 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <span className="block h-2 bg-green-600" style={{ width: `${progressPercent}%` }} />
                    </span>
                    <span className="text-xs" style={{ color: 'var(--txt-3)' }}>{finishedMatchesCount}/{totalMatches}</span>
                  </span>
                )}
                {canPredictNoExisting && (
                  <span className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-xs font-medium">
                    Sem palpites
                  </span>
                )}
                {isTimedClosedOpenOrUpcoming && (
                  <span className="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full text-xs font-medium">
                    Fechada automaticamente
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm" style={{ color: 'var(--txt-3)' }}>{round.matches?.length || 0} jogos</span>
            {isExpanded ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
          </div>
        </button>

        {isExpanded && (
          <div className="border-t p-6" style={{ backgroundColor: 'var(--bg-raised)' }}>
            {canPredictNoExisting && (
              <div className="text-center py-8">
                <Target className="mx-auto text-orange-500 mb-3" size={48} />
                <p className="text-gray-800 font-bold mb-2">Você ainda não fez seus palpites!</p>
                <button
                  onClick={() => handleStartPrediction(round)}
                  className="mt-4 bg-green-600 text-white px-6 py-2 rounded-lg font-semibold"
                >
                  Fazer Palpites Agora
                </button>
              </div>
            )}
            {isUpcomingViewOnly && (
              <div className="text-center py-8">
                <Clock className="mx-auto text-gray-400 mb-3" size={48} />
                <p className="text-gray-700 font-medium">Esta rodada ainda não está aberta para palpites.</p>
                <p className="text-gray-500 text-sm mt-1">Confira os jogos abaixo e aguarde a abertura oficial.</p>
              </div>
            )}
            {isTimedClosedOpenOrUpcoming && (
              <div className="text-center py-8">
                <AlertCircle className="mx-auto text-yellow-600 mb-3" size={48} />
                <p className="text-gray-800 font-bold">Rodada fechada automaticamente para palpites.</p>
                {round.closeAt && (
                  <p className="text-gray-600 text-sm mt-1">Fechada em {formatDateTime(round.closeAt) || round.closeAt}</p>
                )}
              </div>
            )}

            {hasPredictions && (
              <div className="space-y-6">
                {userCartelas.map((cartela, cartelaIndex) => {
                  const est = establishments.find(e => e.id === cartela.establishmentId);
                  const cartelaPoints = points ? points[cartela.code] || 0 : 0;
                  
                  return (
                    <div key={cartela.code} className="bg-white rounded-lg border-2 border-blue-200 overflow-hidden">
                      <div className="bg-blue-50 p-4 border-b border-blue-200">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div>
                            <p className="font-mono text-lg font-bold text-blue-700">🎫 {cartela.code}</p>
                            {est && (
                              <p className="text-xs text-orange-600 flex items-center gap-1 mt-1">
                                <Store size={12} /> {est.name}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`px-3 py-1 rounded-full text-xs font-medium ${cartela.paid ? 'bg-green-600 text-white' : 'bg-orange-100 text-orange-700'}`}>
                              {cartela.paid ? '💰 Pago' : '⚠️ Pendente'}
                            </span>
                            {((round.status === 'finished') || ((round.status === 'closed' || timedClosed) && hasAnyFinished)) && (
                              <span className="bg-green-600 text-white px-3 py-1 rounded-full text-xs font-bold">
                                {cartelaPoints} pontos
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      <div className="p-4 space-y-3">
                        {[...(round.matches || [])].sort(sortMatchesByDate).map((match) => {
                          const homeTeam = teams.find(t => t.id === match.homeTeamId);
                          const awayTeam = teams.find(t => t.id === match.awayTeamId);
                          const pred = cartela.predictions.find(p => p.matchId === match.id);

                          let matchPoints = null;
                          const matchIsLive = !isMatchEffectivelyFinished(match) && match.homeScore !== null && match.awayScore !== null;
                          if ((round.status === 'finished' || round.status === 'closed' || timedClosed) && match.homeScore !== null && match.awayScore !== null && pred && cartela.paid) {
                            if (pred.homeScore === match.homeScore && pred.awayScore === match.awayScore) {
                              matchPoints = 3;
                            } else {
                              const predResult = pred.homeScore > pred.awayScore ? 'home' : pred.homeScore < pred.awayScore ? 'away' : 'draw';
                              const matchResult = match.homeScore > match.awayScore ? 'home' : match.homeScore < match.awayScore ? 'away' : 'draw';
                              if (predResult === matchResult) {
                                matchPoints = 1;
                              } else {
                                matchPoints = 0;
                              }
                            }
                          }

                          return (
                            <div key={match.id} className="bg-gray-50 rounded-lg p-3 border">
                              <div className="space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <img src={getSafeLogo(homeTeam)} alt={homeTeam?.name || ''} className="w-6 h-6 object-contain rounded bg-white ring-1 ring-gray-200 flex-shrink-0" width={24} height={24} />
                                    <span className="font-medium text-xs truncate">{homeTeam?.name}</span>
                                  </div>
                                  <span className="text-gray-400 font-bold text-xs px-1 flex-shrink-0">VS</span>
                                  <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
                                    <span className="font-medium text-xs truncate">{awayTeam?.name}</span>
                                    <img src={getSafeLogo(awayTeam)} alt={awayTeam?.name || ''} className="w-6 h-6 object-contain rounded bg-white ring-1 ring-gray-200 flex-shrink-0" width={24} height={24} />
                                  </div>
                                </div>
                                
                                {pred && (
                                  <div className="flex items-center justify-center gap-2">
                                    <span className="text-xs text-gray-500">Palpite:</span>
                                    <div className="flex items-center gap-2">
                                      <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded font-bold text-sm">{pred.homeScore}</span>
                                      <span className="text-gray-400 font-bold text-xs">X</span>
                                      <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded font-bold text-sm">{pred.awayScore}</span>
                                    </div>
                                  </div>
                                )}
                                
                                {match.homeScore !== null && match.awayScore !== null && (
                                  <div className="flex items-center justify-center gap-2">
                                    <span className="text-xs text-gray-500 flex items-center gap-1">
                                      {isMatchEffectivelyFinished(match) ? 'Final:' : <><span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse inline-block" />Parcial:</>}
                                    </span>
                                    <div className="flex items-center gap-2">
                                      <span className={`px-2 py-1 rounded font-bold text-sm text-white ${isMatchEffectivelyFinished(match) ? 'bg-green-600' : 'bg-red-500'}`}>{match.homeScore}</span>
                                      <span className="text-gray-400 font-bold text-xs">X</span>
                                      <span className={`px-2 py-1 rounded font-bold text-sm text-white ${isMatchEffectivelyFinished(match) ? 'bg-green-600' : 'bg-red-500'}`}>{match.awayScore}</span>
                                    </div>
                                  </div>
                                )}

                                {matchPoints !== null && (
                                  <div className="flex justify-center items-center gap-1.5 pt-2">
                                    {matchPoints === 3 && <span className={`text-white px-2 py-1 rounded-full text-xs font-bold ${matchIsLive ? 'bg-orange-500' : 'bg-green-600'}`}>{matchIsLive ? '~' : '+'}3</span>}
                                    {matchPoints === 1 && <span className={`text-white px-2 py-1 rounded-full text-xs font-bold ${matchIsLive ? 'bg-orange-400' : 'bg-blue-600'}`}>{matchIsLive ? '~' : '+'}1</span>}
                                    {matchPoints === 0 && <span className="bg-red-100 text-red-700 px-2 py-1 rounded-full text-xs font-bold">0</span>}
                                    {matchIsLive && matchPoints !== null && <span className="text-xs text-orange-500 font-medium">parcial</span>}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      
                      {round.status === 'finished' && !cartela.paid && (
                        <div className="p-3 bg-orange-50 border-t border-orange-200">
                          <p className="text-xs text-orange-700 font-medium text-center">
                            ⚠️ Pagamento pendente - Pontos não computados
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
                {(() => {
                  const pendingCartelas = userCartelas.filter(c => !c.paid);
                  const pendingCodes = pendingCartelas.map(c => c.code);
                  const totalAmount = (settings?.betValue || 15) * pendingCartelas.length;
                  if (pendingCartelas.length === 0) return null;
                  return (
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3" aria-live="polite">
                      <div className="flex items-center gap-2">
                        <DollarSign className="text-blue-600" size={20} />
                        <p className="text-sm text-blue-800">
                          Você tem {pendingCartelas.length} participação(ões) pendentes nesta rodada.
                        </p>
                      </div>
                      <button
                        onClick={() => openPaymentForRound(round, pendingCodes, totalAmount)}
                        disabled={!!paymentLocks[round.id]}
                        className={`px-4 py-2 rounded-lg font-semibold focus:outline-none focus:ring-2 ${paymentLocks[round.id] ? 'bg-gray-300 text-gray-600 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-400'}`}
                        aria-label={`Gerar pagamento de ${fmtBRL(totalAmount)} para ${pendingCartelas.length} participação(ões)`}
                      >
                        {paymentLocks[round.id] ? 'Processando...' : `Gerar Pagamento • ${fmtBRL(totalAmount)}`}
                      </button>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const openPaymentForRound = (round, cartelaCodes, amount) => {
    if (paymentLocks[round.id]) return;
    setPaymentLocks(prev => ({ ...prev, [round.id]: true }));
    setPaymentContext({ roundId: round.id, roundName: round.name, cartelaCodes, amount });
    setPaymentModalOpen(true);
  };

  const PredictionForm = ({ round, initialPredictions = null }) => {
    const [localPreds, setLocalPreds] = useState({});
    const [cartelaCode] = useState(generateCartelaCode());
    const timedClosed = isRoundTimedClosed(round);
    
    useEffect(() => {
      if (initialPredictions) {
        const predsObj = {};
        initialPredictions.forEach(pred => {
          predsObj[pred.match.id] = {
            home: pred.homeScore,
            away: pred.awayScore
          };
        });
        setLocalPreds(predsObj);
      }
    }, [initialPredictions]);

    const handleSubmit = () => {
      if (timedClosed) {
        alert('Rodada fechada para palpites pelo cronograma definido.');
        return;
      }
      if (!Array.isArray(round.matches) || round.matches.length === 0) {
        alert('Rodada sem jogos configurados. Aguarde o administrador adicionar os confrontos.');
        return;
      }
      const allPreds = round.matches.map(match => ({
        match,
        homeScore: localPreds[match.id]?.home !== undefined ? parseInt(localPreds[match.id].home) : null,
        awayScore: localPreds[match.id]?.away !== undefined ? parseInt(localPreds[match.id].away) : null
      }));

      // Validar preenchimento e faixas válidas (apenas inteiros entre 0 e 20)
      const hasEmpty = allPreds.some(p => p.homeScore === null || p.awayScore === null);
      if (hasEmpty) {
        alert('Preencha todos os palpites!');
        return;
      }
      const invalidValues = allPreds.some(p => {
        const hs = p.homeScore; const as = p.awayScore;
        return !Number.isInteger(hs) || !Number.isInteger(as) || hs < 0 || as < 0 || hs > 20 || as > 20;
      });
      if (invalidValues) {
        alert('Insira pontuações válidas (0–20) inteiras em todos os jogos.');
        return;
      }

      setPendingPredictions({ round, predictions: allPreds, cartelaCode, establishmentId: currentUser.establishmentId || null });
      setShowConfirmModal(true);
    };

    const selectedEst = establishments.find(e => e.id === currentUser.establishmentId);

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          <div className="p-6 border-b sticky top-0 bg-white">
            <h3 className="text-2xl font-bold">{round.name}</h3>
            <div className="flex items-center gap-3 mt-2">
              <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-sm font-mono font-bold">
                🎫 {cartelaCode}
              </span>
              <span className="text-gray-600 text-sm">R$ {settings?.betValue?.toFixed(2) || '15,00'}</span>
              {selectedEst && (
                <span className="bg-orange-100 text-orange-700 px-3 py-1 rounded-full text-sm font-bold flex items-center gap-1">
                  <Store size={14} /> {selectedEst.name}
                </span>
              )}
            </div>
          </div>
          <div className="p-6 space-y-4">
            {timedClosed && (
              <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg">
                🔒 Rodada fechada automaticamente {round.closeAt && (<span>em {formatDateTime(round.closeAt) || round.closeAt}</span>)}.
              </div>
            )}
            {[...(round.matches || [])].sort(sortMatchesByDate).map((match) => {
              const homeTeam = teams.find(t => t.id === match.homeTeamId);
              const awayTeam = teams.find(t => t.id === match.awayTeamId);
              return (
                <div key={match.id} className="bg-gray-50 p-4 rounded-lg">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-1">
                        <img src={getSafeLogo(homeTeam)} alt={homeTeam?.name || ''} className="w-8 h-8 object-contain rounded bg-white ring-1 ring-gray-200 flex-shrink-0" width={32} height={32} />
                        <span className="font-medium text-sm truncate">{homeTeam?.name}</span>
                      </div>
                      <span className="text-gray-400 font-bold px-2">VS</span>
                      <div className="flex items-center gap-2 flex-1 justify-end">
                        <span className="font-medium text-sm truncate">{awayTeam?.name}</span>
                        <img src={getSafeLogo(awayTeam)} alt={awayTeam?.name || ''} className="w-8 h-8 object-contain rounded bg-white ring-1 ring-gray-200 flex-shrink-0" width={32} height={32} />
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-center gap-3">
                      <input 
                        type="number" 
                        min="0" 
                        max="9" 
                        value={localPreds[match.id]?.home ?? ''} 
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val !== '' && (parseInt(val) < 0 || parseInt(val) > 9)) return;
                          setLocalPreds({ ...localPreds, [match.id]: { ...localPreds[match.id], home: val } });
                        }} 
                        disabled={timedClosed}
                        className="w-16 px-2 py-2 border rounded text-center font-bold" 
                      />
                      <span className="font-bold text-gray-400">X</span>
                      <input 
                        type="number" 
                        min="0" 
                        max="9" 
                        value={localPreds[match.id]?.away ?? ''} 
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val !== '' && (parseInt(val) < 0 || parseInt(val) > 9)) return;
                          setLocalPreds({ ...localPreds, [match.id]: { ...localPreds[match.id], away: val } });
                        }} 
                        disabled={timedClosed}
                        className="w-16 px-2 py-2 border rounded text-center font-bold" 
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="p-6 border-t flex gap-3 sticky bottom-0 bg-white">
            <button onClick={() => { setSelectedRound(null); setEditingPredictions(null); setPendingPredictions(null); }} className="px-6 py-2 border rounded-lg">Cancelar</button>
            <button onClick={handleSubmit} disabled={timedClosed} className={`px-6 py-2 rounded-lg ${timedClosed ? 'bg-gray-300 text-gray-600 cursor-not-allowed' : 'bg-green-600 text-white'}`}>Confirmar</button>
          </div>
        </div>
      </div>
    );
  };

  const ConfirmModal = ({ round, predictionsData, cartelaCode, establishmentId, onConfirm, onCancel }) => {
    const handleRevisar = () => {
      setEditingPredictions(predictionsData);
      setShowConfirmModal(false);
    };

    const selectedEst = establishments.find(e => e.id === establishmentId);

    return (
      <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
          <div className="p-6 bg-gradient-to-r from-yellow-500 to-orange-500 text-white rounded-t-2xl">
            <div className="flex items-center gap-3">
              <Award size={32} />
              <div>
                <h3 className="text-2xl font-bold">Confirmar Palpites</h3>
                <p className="text-yellow-100">{round.name}</p>
                <p className="text-yellow-100 font-mono text-sm mt-1">🎫 {cartelaCode}</p>
                {selectedEst && (
                  <p className="text-yellow-100 text-sm mt-1 flex items-center gap-1">
                    <Store size={14} /> {selectedEst.name}
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="p-6">
            <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4 mb-6">
              <div className="flex items-start gap-3">
                <div className="bg-red-500 text-white p-2 rounded-full"><X size={20} /></div>
                <div>
                  <h4 className="font-bold text-red-900 text-lg mb-2">⚠️ Atenção!</h4>
                  <p className="text-red-800 font-medium">Após confirmar, você <span className="underline">NÃO PODERÁ MAIS</span> alterar!</p>
                  <p className="text-red-700 text-sm mt-2">💰 Lembre-se de efetuar o pagamento de R$ {Number(settings?.betValue ?? 15).toFixed(2).replace('.', ',')} para validar seus pontos.</p>
                </div>
              </div>
            </div>
            <div className="bg-gray-50 rounded-xl p-4 mb-6 max-h-60 overflow-y-auto">
              <h4 className="font-semibold mb-3">Seus palpites:</h4>
              <div className="space-y-2">
                {[...(round?.matches || [])].sort(sortMatchesByDate).map((match) => {
                  const pred = predictionsData.find(p => p.match?.id === match.id);
                  if (!pred) return null;
                  const homeTeam = teams.find(t => t.id === match.homeTeamId);
                  const awayTeam = teams.find(t => t.id === match.awayTeamId);
                  return (
                    <div key={match.id} className="flex items-center justify-between bg-white p-3 rounded-lg border">
                      <div className="flex items-center gap-2 text-sm">
                        <img src={getSafeLogo(homeTeam)} alt={homeTeam?.name || ''} className="w-6 h-6 object-contain rounded bg-white ring-1 ring-gray-200" width={24} height={24} />
                        <span className="font-medium">{homeTeam?.name}</span>
                      </div>
                      <div className="flex items-center gap-2 font-bold text-green-600">
                        <span className="bg-green-100 px-3 py-1 rounded">{pred.homeScore}</span>
                        <span className="text-gray-400">X</span>
                        <span className="bg-green-100 px-3 py-1 rounded">{pred.awayScore}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <img src={getSafeLogo(awayTeam)} alt={awayTeam?.name || ''} className="w-6 h-6 object-contain rounded bg-white ring-1 ring-gray-200" width={24} height={24} />
                        <span className="font-medium">{awayTeam?.name}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6">
              <div className="flex justify-between">
                <span className="text-green-800 font-medium">Valor:</span>
                <span className="text-2xl font-bold text-green-600">R$ {settings?.betValue?.toFixed(2) || '15,00'}</span>
              </div>
            </div>
          </div>
          <div className="p-6 border-t flex gap-3">
            <button onClick={handleRevisar} className="flex-1 px-6 py-3 border-2 rounded-lg font-semibold hover:bg-gray-50">Revisar Palpites</button>
            <button onClick={onConfirm} className="flex-1 px-6 py-3 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-lg font-bold hover:from-green-700 hover:to-green-800">Confirmar Definitivo</button>
          </div>
        </div>
      </div>
    );
  };

  const CartelaDetailsModal = ({ round, cartela, onClose }) => {
    const { teams, establishments } = useApp();
    return (
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-white w-[95%] max-w-3xl rounded-xl shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-4 border-b">
            <div>
              <h3 className="text-lg font-bold">Palpites do Participante</h3>
              <p className="text-sm text-gray-500">{round?.name}</p>
            </div>
            <button className="p-2 rounded hover:bg-gray-100" onClick={onClose} aria-label="Fechar">
              <X size={20} />
            </button>
          </div>

          <div className="p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm bg-blue-100 text-blue-700 px-2 py-1 rounded">{cartela?.code}</span>
                {cartela?.establishmentId && (
                  <span className="inline-flex items-center gap-1 text-xs text-orange-600">
                    <Store size={12} /> {(establishments.find(e => e.id === cartela.establishmentId) || {}).name}
                  </span>
                )}
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
                  {[...(round?.matches || [])].sort(sortMatchesByDate).map((match) => {
                    const p = cartela?.predictions?.find(pr => pr.matchId === match.id);
                    if (!p) return null;
                    const homeTeam = teams.find(t => t.id === match.homeTeamId) || teams.find(t => t.name === match.homeTeam);
                    const awayTeam = teams.find(t => t.id === match.awayTeamId) || teams.find(t => t.name === match.awayTeam);

                    let pts = 0;
                    if (isMatchEffectivelyFinished(match) && match.homeScore !== null && match.awayScore !== null) {
                      if (p.homeScore === match.homeScore && p.awayScore === match.awayScore) {
                        pts = 3;
                      } else {
                        const predRes = p.homeScore > p.awayScore ? 'home' : p.homeScore < p.awayScore ? 'away' : 'draw';
                        const matchRes = match.homeScore > match.awayScore ? 'home' : match.homeScore < match.awayScore ? 'away' : 'draw';
                        if (predRes === matchRes) pts = 1;
                      }
                    }

                    return (
                      <tr key={match.id}>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <img src={getSafeLogo(homeTeam)} alt={homeTeam?.name || ''} className="w-5 h-5 object-contain rounded bg-white ring-1 ring-gray-200" width={20} height={20} />
                            <span className="truncate max-w-[8rem]">{homeTeam?.name}</span>
                            <span className="text-gray-400 font-bold mx-2">X</span>
                            <span className="truncate max-w-[8rem]">{awayTeam?.name}</span>
                            <img src={getSafeLogo(awayTeam)} alt={awayTeam?.name || ''} className="w-5 h-5 object-contain rounded bg-white ring-1 ring-gray-200" width={20} height={20} />
                          </div>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="inline-flex items-center gap-2">
                            <span className="text-sm font-bold bg-gray-100 px-2 py-1 rounded">{p.homeScore}</span>
                            <span className="text-sm font-bold bg-gray-100 px-2 py-1 rounded">{p.awayScore}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          {isMatchEffectivelyFinished(match) ? (
                            <span className="text-xs text-gray-700">{match.homeScore} x {match.awayScore}</span>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`text-xs font-bold px-2 py-1 rounded ${pts > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{pts}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="p-4 border-t">
            <button onClick={onClose} className="w-full px-4 py-2 border rounded-lg">Fechar</button>
          </div>
        </div>
      </div>
    );
  };

  const PaymentModal = ({ open, onClose, context, currentUser, onStart, onApproved, onError }) => {
    const { users, settings, predictions } = useApp();
    const [stage, setStage] = useState('collect'); // collect | creating | showing | expired | approved | error
    const [error, setError] = useState('');
    const [tx, setTx] = useState(null);
    const [copied, setCopied] = useState('');
    const [timeLeftMs, setTimeLeftMs] = useState(0);
    const [retryCount, setRetryCount] = useState(0);
    const [approvedAt, setApprovedAt] = useState(null);
    const [qrDataUrl, setQrDataUrl] = useState(null);
    const [payer, setPayer] = useState({
      name: currentUser?.name || '',
      email: currentUser?.email || '',
      cpf: '',
      pixKey: ''
    });
    const pollRef = useRef(null);
    const creatingRef = useRef(false);       // guarda contra chamadas concorrentes
    const approvedRef = useRef(false);       // bloqueia permanentemente após aprovação

    useEffect(() => {
      if (!open) return;
      if (approvedRef.current) return;         // pagamento já aprovado, nada a fazer
      if (stage === 'approved') return;
      if (stage !== 'collect') return;
      setError(''); setTx(null); setCopied('');
      try {
        const roundId = context?.roundId;
        const codes = Array.isArray(context?.cartelaCodes) ? context.cartelaCodes : [];
        const myPreds = predictions.filter(p => p.userId === currentUser?.id && p.roundId === roundId && (codes.length ? codes.includes(p.cartelaCode) : true));
        const anyPending = myPreds.length > 0 ? myPreds.some(p => !p.paid) : true;
        if (!anyPending) {
          approvedRef.current = true;
          setApprovedAt(new Date());
          setStage('approved');
        } else {
          setStage('collect');
        }
      } catch {
        setStage('collect');
      }
    }, [open, stage]);

    // Ao abrir, criar automaticamente as instruções e ir direto para a exibição
    useEffect(() => {
      if (!open) return;
      if (approvedRef.current) return;         // pagamento já aprovado, bloqueia
      if (stage !== 'collect') return;
      handleCreate();
    }, [open, stage]);

    // Monitora atualizações de pagamento no banco e muda para 'approved'
    useEffect(() => {
      if (!open) return;
      const roundId = context?.roundId;
      const codes = Array.isArray(context?.cartelaCodes) ? context.cartelaCodes : [];
      if (!roundId || !currentUser?.id) return;
      const myPreds = predictions.filter(p => p.userId === currentUser.id && p.roundId === roundId && (codes.length ? codes.includes(p.cartelaCode) : true));
      if (myPreds.length > 0 && myPreds.every(p => !!p.paid)) {
        approvedRef.current = true; // bloqueia permanentemente novos QR Codes
        setApprovedAt(new Date());
        setStage('approved');
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }, [predictions, open, context?.roundId, context?.cartelaCodes, currentUser?.id]);

    useEffect(() => {
      if (!tx?.expiration) return;
      const update = () => {
        const remaining = Math.max(0, new Date(tx.expiration).getTime() - Date.now());
        setTimeLeftMs(remaining);
        if (remaining === 0 && !approvedRef.current) setStage(s => s === 'showing' ? 'expired' : s);
      };
      update();
      const id = setInterval(update, 1000);
      return () => clearInterval(id);
    }, [tx?.expiration]);

    useEffect(() => {
      if (!tx?.brCode) { setQrDataUrl(null); return; }
      import('qrcode').then(mod => {
        const QRCode = mod.default;
        QRCode.toDataURL(tx.brCode, { width: 192, margin: 2 })
          .then(url => setQrDataUrl(url))
          .catch(() => setQrDataUrl(null));
      }).catch(() => setQrDataUrl(null));
    }, [tx?.brCode]);

    const formatLeft = () => {
      const s = Math.floor(timeLeftMs / 1000);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const ss = s % 60;
      return h > 0
        ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
        : `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    };

    const handleCreate = async () => {
      if (stage !== 'collect') return;
      if (creatingRef.current) return;   // impede chamadas simultâneas
      if (approvedRef.current) return;   // pagamento já aprovado, não cria novo
      creatingRef.current = true;
      try {
        setError(''); setStage('creating');
        try { if (typeof onStart === 'function') onStart(); } catch {}

        // wooviEnabled vem do public_config (usuário) ou é derivado do appId (admin).
        const wooviEnabled = settings?.wooviEnabled ?? !!settings?.woovi?.appId?.trim();
        const cartelaCode = Array.isArray(context?.cartelaCodes) ? context.cartelaCodes[0] : null;

        // Modo Woovi: gerar QR Code PIX automático
        if (wooviEnabled && cartelaCode) {
          // Sempre adiciona timestamp para garantir correlationID único no Woovi
          const correlationID = `${cartelaCode}_${Date.now()}`;
          const res = await fetch('/api/payments/woovi-charge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: currentUser?.id,
              roundId: context?.roundId,
              cartelaCode,
              amount: context?.amount,
              correlationID
            })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.details || data.error || 'Erro Woovi');
          setTx({ mode: 'woovi', qrCodeImage: data.qrCodeImage, brCode: data.brCode, expiration: data.expiresAt, value: data.value });
        } else {
          // Modo manual: mostrar chave PIX
          const pixKey = (settings?.payment?.pixKey ?? settings?.pixKey ?? '').trim() || 'CHAVE-PIX-MOCK-TESTE';
          setTx({ mode: 'manual', pixKey });
        }

        setStage('showing');
        try {
          await addDoc(collection(db, 'user_events'), {
            userId: currentUser?.id,
            type: 'pix_instructions_viewed',
            roundId: context?.roundId || null,
            amount: context?.amount || null,
            createdAt: serverTimestamp()
          });
        } catch {}
      } catch (e) {
        setError(e?.message || 'Falha ao preparar instruções PIX');
        setStage('error');
        try { if (typeof onError === 'function') onError(e); } catch {}
      } finally {
        creatingRef.current = false;
      }
    };

    const handleCopy = async () => {
      const key = (settings?.payment?.pixKey ?? settings?.pixKey ?? '').trim();
      if (!key) return;
      try {
        await navigator.clipboard.writeText(key);
        setCopied('copiado');
        setTimeout(() => setCopied(''), 1500);
        try {
          await addDoc(collection(db, 'user_events'), {
            userId: currentUser?.id,
            type: 'pix_key_copied',
            roundId: context?.roundId || null,
            amount: context?.amount || null,
            createdAt: serverTimestamp()
          });
        } catch {}
      } catch {
        setCopied('erro');
        setTimeout(() => setCopied(''), 1500);
      }
    };

    const closeModal = () => {
      if (pollRef.current) clearInterval(pollRef.current);
      onClose();
    };

    const formatDateTimeBR = (date) => {
      try {
        return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(date);
      } catch {
        return (date || new Date()).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      }
    };

    const normalizePhone = (s) => {
      const d = String(s || '').replace(/\D/g, '');
      return d.length > 11 ? d.slice(-11) : d; // DDD+numero
    };

    const handleCopyTxId = async () => {
      if (!tx?.id) return;
      try {
        await navigator.clipboard.writeText(tx.id);
        setCopied('copiado');
        setTimeout(() => setCopied(''), 1500);
      } catch {
        setCopied('erro');
        setTimeout(() => setCopied(''), 1500);
      }
    };

    // Sem cópia de mensagem para WhatsApp; apenas exibição de chave e nome do recebedor

    const supportHref = `mailto:?subject=Suporte%20Pagamento%20PIX&body=Descreva%20o%20problema%20e%20informe%20rodada,%20valor%20e%20participações.`;

    if (!open) return null;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true" aria-label="Pagamento Checkout">
        <div className="bg-white rounded-xl w-[95%] sm:w-full max-w-xl max-h-[90vh] overflow-y-auto">
          <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-white z-10">
            <div className="flex items-center gap-2">
              <DollarSign className="text-green-600" size={22} />
              <h3 className="text-lg font-bold">Pagamento</h3>
            </div>
            <button onClick={closeModal} className="p-2 rounded hover:bg-gray-100" aria-label="Fechar">
              <X size={18} />
            </button>
          </div>

          {stage === 'collect' && (
            <div className="p-6 text-center space-y-3">
              <Loader2 className="mx-auto animate-spin text-green-600" size={28} />
              <p className="text-sm text-gray-700">Carregando instruções do PIX...</p>
            </div>
          )}

          {stage === 'creating' && (
            <div className="p-6 text-center space-y-3">
              <Loader2 className="mx-auto animate-spin text-green-600" size={28} />
              <p className="text-sm text-gray-700">Preparando instruções...</p>
            </div>
          )}

          {stage === 'expired' && (
            <div className="p-8 text-center space-y-4">
              <Clock className="mx-auto text-orange-400" size={48} />
              <p className="text-gray-800 font-semibold text-lg">QR Code expirado</p>
              <p className="text-gray-500 text-sm">O tempo para pagar este PIX esgotou.<br/>Gere um novo QR Code para continuar.</p>
              <button
                onClick={() => { if (!approvedRef.current) { setTx(null); setTimeLeftMs(0); setRetryCount(r => r + 1); setStage('collect'); } }}
                className="bg-green-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-green-700"
              >
                Gerar novo QR Code
              </button>
            </div>
          )}

          {stage === 'showing' && tx && (
            <div className="p-4 space-y-4">
              <div className="text-center">
                <p className="text-xl font-bold text-green-700">{fmtBRL(context?.amount || tx?.value || 0)}</p>
              </div>

              {/* Modo Woovi: QR Code PIX */}
              {tx.mode === 'woovi' && (
                <div className="flex flex-col items-center gap-3">
                  {(qrDataUrl || tx.qrCodeImage) && (
                    <img src={qrDataUrl || tx.qrCodeImage} alt="QR Code PIX" className="w-48 h-48 border rounded-lg" />
                  )}
                  <p className="text-sm text-gray-600 text-center">Escaneie o QR Code ou copie o código PIX abaixo</p>
                  {tx.brCode && (
                    <div className="w-full">
                      <div className="flex gap-2">
                        <input readOnly value={tx.brCode} className="flex-1 px-3 py-2 border rounded-lg text-xs font-mono bg-gray-50" />
                        <button
                          onClick={async () => {
                            try { await navigator.clipboard.writeText(tx.brCode); setCopied('copiado'); setTimeout(() => setCopied(''), 1500); } catch { setCopied('erro'); setTimeout(() => setCopied(''), 1500); }
                          }}
                          className="px-3 py-2 bg-gray-800 text-white rounded text-sm"
                        >Copiar</button>
                      </div>
                      {copied === 'copiado' && <p className="text-xs text-green-600 mt-1 flex items-center gap-1"><Check size={12} />Código copiado!</p>}
                    </div>
                  )}
                  {tx.expiration && timeLeftMs > 0 && (
                    <p className="text-sm font-mono font-semibold text-orange-500">
                      ⏱ Expira em: {formatLeft()}
                    </p>
                  )}
                  <div className="w-full bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                    <p className="font-semibold mb-1">Como pagar:</p>
                    <p>1) Escaneie o QR Code ou copie o código PIX acima.</p>
                    <p>2) Abra seu banco e pague via PIX Copia e Cola.</p>
                    <p>3) Aguarde — a confirmação é automática! ✅</p>
                  </div>
                </div>
              )}

              {/* Modo manual: chave PIX */}
              {tx.mode !== 'woovi' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Chave PIX (administrador)</label>
                    <div className="flex gap-2">
                      <input readOnly value={settings?.payment?.pixKey ?? settings?.pixKey ?? ''} className="flex-1 px-3 py-2 border rounded-lg text-xs" />
                      <button onClick={handleCopy} className="px-3 py-2 bg-gray-800 text-white rounded text-sm">Copiar</button>
                    </div>
                    {copied === 'copiado' && <p className="text-xs text-green-600 mt-1 flex items-center gap-1"><Check size={12} />Chave copiada!</p>}
                    {(() => { const name = (settings?.payment?.pixRecipientName ?? settings?.pixRecipientName ?? '').trim(); return name ? <p className="text-xs text-gray-500 mt-1">Destinatário: {name}</p> : null; })()}
                  </div>
                  <div className="text-sm text-gray-600 space-y-1">
                    <p className="font-medium">Como pagar:</p>
                    <p>1) Abra seu banco e pague via PIX com a chave acima.</p>
                    <p>2) Confirme o destinatário e o valor.</p>
                    <p>3) Envie o comprovante ao administrador pelo WhatsApp.</p>
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-1">
                <button onClick={closeModal} className="px-4 py-2 border rounded">Fechar</button>
              </div>
            </div>
          )}

          {stage === 'approved' && (
            <div className="p-6 space-y-4">
              <div className="text-center">
                <CheckCircle className="mx-auto text-green-600 animate-bounce" size={48} />
                <p className="mt-3 text-xl font-bold text-green-700">✅ Pagamento Confirmado!</p>
                <p className="text-sm text-gray-600 mt-1">Seus palpites estão válidos. Boa sorte! 🍀</p>
                <p className="text-xs text-gray-400 mt-2">Esta janela será fechada automaticamente...</p>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-green-700 font-medium">Valor pago</span>
                  <span className="text-green-800 font-bold">{fmtBRL(context?.amount || 0)}</span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-green-700 font-medium">Data/hora</span>
                  <span className="text-green-800">{formatDateTimeBR(approvedAt || new Date())}</span>
                </div>
              </div>
              <button onClick={closeModal} className="w-full px-4 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700">
                Fechar
              </button>
            </div>
          )}

          {stage === 'error' && (
            <div className="p-6 space-y-3">
              <div className="flex items-center gap-2 text-red-700">
                <XCircle size={22} />
                <p className="font-semibold">Falha ao preparar instruções de pagamento</p>
              </div>
              {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded">{error}</div>}
              <div className="flex items-center gap-2">
                <button onClick={() => { if (!approvedRef.current) { setStage('collect'); setError(''); } }} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Tentar novamente</button>
                <a href={supportHref} className="px-4 py-2 border rounded" target="_blank" rel="noopener noreferrer">Suporte</a>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const confirmAndSave = async () => {
    if (!pendingPredictions) return;
    try {
      const { round, predictions: preds, cartelaCode, establishmentId } = pendingPredictions;
      // Checagem adicional antes de salvar
      if (isRoundTimedClosed(round)) {
        alert('Rodada fechada para palpites pelo cronograma definido.');
        return;
      }
      if (!Array.isArray(round.matches) || round.matches.length === 0) {
        alert('Rodada sem jogos configurados. Aguarde o administrador adicionar os confrontos.');
        return;
      }
      if (preds.length !== round.matches.length) {
        alert('Palpites incompletos. Revise e preencha todos os jogos.');
        return;
      }
      const invalidValues = preds.some(p => {
        const hs = p.homeScore; const as = p.awayScore;
        return !Number.isInteger(hs) || !Number.isInteger(as) || hs < 0 || as < 0 || hs > 20 || as > 20;
      });
      if (invalidValues) {
        alert('Insira pontuações válidas (0–20) inteiras em todos os jogos.');
        return;
      }
      
      for (const pred of preds) {
        await addPrediction({
          userId: currentUser.id,
          roundId: round.id,
          matchId: pred.match.id,
          homeScore: pred.homeScore,
          awayScore: pred.awayScore,
          cartelaCode: cartelaCode,
          establishmentId: establishmentId || null,
          finalized: true
        });
      }
      
      // Enviar confirmação via WhatsApp automático (Evolution API, server-side)
      try {
        const settingsSnapshot = await getDocs(collection(db, 'settings'));
        const valorRodada = (settings?.betValue ?? 15).toFixed(2).replace('.', ',');
        let messageTemplate = `🏆 *BOLÃO BRASILEIRÃO 2026*\n\n📋 *{RODADA}*\n🎫 *Cartela: {CARTELA}*\n✅ Palpites registrados!\n\n{PALPITES}\n\n💰 *Valor: R$ {VALOR}*\n\n👉 Para ativar seus palpites, clique em *Efetuar Pagamento* na tela da rodada.\n\nBoa sorte! 🍀`;
        let evolutionCfg = null;

        if (!settingsSnapshot.empty) {
          const sd = settingsSnapshot.docs[0].data();
          if (sd.whatsappMessage) messageTemplate = sd.whatsappMessage;
          if (sd?.devolution?.link && sd?.devolution?.instanceName && sd?.devolution?.token) {
            evolutionCfg = { link: sd.devolution.link, instance: sd.devolution.instanceName, token: sd.devolution.token };
          }
        }

        // Montar texto dos palpites
        let palpitesText = '';
        preds.forEach((pred, i) => {
          const ht = teams.find(t => t.id === pred.match.homeTeamId);
          const at = teams.find(t => t.id === pred.match.awayTeamId);
          palpitesText += `${i + 1}. ${ht?.name || '?'} ${pred.homeScore} x ${pred.awayScore} ${at?.name || '?'}\n`;
        });

        // Substituir tags da mensagem
        let message = messageTemplate
          .replace('{RODADA}', round.name)
          .replace('{CARTELA}', cartelaCode)
          .replace('{PALPITES}', palpitesText.trim())
          .replace('{VALOR}', valorRodada);

        // Enviar via proxy serverless (sem abrir WhatsApp Web)
        if (evolutionCfg && currentUser.whatsapp) {
          let phone = currentUser.whatsapp.replace(/\D/g, '');
          if (!phone.startsWith('55')) phone = '55' + phone;
          fetch('/api/evolution/sendText', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ number: phone, text: message, ...evolutionCfg })
          }).catch(err => console.error('WhatsApp send error:', err));
        } else {
          console.warn('Evolution API não configurada; mensagem de confirmação não enviada.');
        }
      } catch (whatsappError) {
        console.error('Erro ao enviar WhatsApp de confirmação:', whatsappError);
      }

      setShowConfirmModal(false);
      setPendingPredictions(null);
      setSelectedRound(null);
      setEditingPredictions(null);

      // Abrir modal de pagamento automaticamente logo após a confirmação
      const betValue = settings?.betValue || 15;
      openPaymentForRound(round, [cartelaCode], betValue);

    } catch (error) {
      console.error('❌ Erro ao salvar palpites:', error);
      alert('Erro ao salvar palpites: ' + error.message);
    }
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
      
      let points = 0;
      round.matches?.forEach(match => {
        const pred = cartelaPreds.find(p => p.matchId === match.id);
        
        // Conta pontos se houver placar disponível — inclusive parcial (jogo em andamento).
        // Para rodadas finalizadas, todos os matches têm finished=true, sem diferença.
        if (pred && match.homeScore !== null && match.awayScore !== null) {
          if (pred.homeScore === match.homeScore && pred.awayScore === match.awayScore) {
            points += 3;
          } else {
            const predResult = pred.homeScore > pred.awayScore ? 'home' : pred.homeScore < pred.awayScore ? 'away' : 'draw';
            const matchResult = match.homeScore > match.awayScore ? 'home' : match.homeScore < match.awayScore ? 'away' : 'draw';
            if (predResult === matchResult) {
              points += 1;
            }
          }
        }
      });
      return points;
    }

    const userRoundPreds = predictions.filter(p => p.userId === userId && p.roundId === roundId);
    const cartelaCodes = [...new Set(userRoundPreds.map(p => p.cartelaCode || 'ANTIGA'))];

    return cartelaCodes.reduce((sum, code) => {
      return sum + calculateUserRoundPoints(userId, roundId, code);
    }, 0);
  };

  const getRankingForRound = (roundId) => {
    if (!roundId) return [];
    
    const rankingEntries = [];
    
    users.filter(u => !u.isAdmin).forEach(user => {
      const userRoundPreds = predictions.filter(p => p.userId === user.id && p.roundId === roundId);
      const cartelaCodes = [...new Set(userRoundPreds.map(p => p.cartelaCode || 'ANTIGA'))];
      
      cartelaCodes.forEach(cartelaCode => {
        const cartelaPreds = userRoundPreds.filter(p => (p.cartelaCode || 'ANTIGA') === cartelaCode);
        const isPaid = cartelaPreds.length > 0 && cartelaPreds[0]?.paid;
        
        if (!isPaid) return;
        
        const points = calculateUserRoundPoints(user.id, roundId, cartelaCode);
        
        rankingEntries.push({
          user,
          cartelaCode,
          establishmentId: cartelaPreds[0]?.establishmentId,
          points,
          predictions: cartelaPreds.length,
          isPaid: true
        });
      });
    });
    
    return rankingEntries.sort((a, b) => b.points - a.points);
  };

  const getRoundPrize = (roundId) => {
    const round = rounds.find(r => r.id === roundId);
    if (!round || round.status !== 'finished') return null;

    const betValue = settings?.betValue || 15;
    const ranking = getRankingForRound(roundId);
    if (ranking.length === 0) return null;

    const totalPaid = ranking.length * betValue;
    const prizePool = totalPaid * 0.85;
    const maxPoints = ranking[0].points;
    const winners = ranking.filter(r => r.points === maxPoints);
    const prizePerWinner = prizePool / winners.length;

    return {
      totalPaid,
      prizePool,
      winners,
      prizePerWinner
    };
  };

  const userPredictions = predictions.filter(p => p.userId === currentUser.id);
  const totalPoints = rounds
    .filter(r => r.status === 'finished')
    .reduce((sum, round) => {
      const cartelaPoints = calculateRoundPoints(round.id);
      if (cartelaPoints) {
        return sum + Object.values(cartelaPoints).reduce((a, b) => a + b, 0);
      }
      return sum;
    }, 0);
  
  // Cache do ranking para melhorar performance
  const ranking = useMemo(() => {
    return selectedRankingRound ? getRankingForRound(selectedRankingRound) : [];
  }, [selectedRankingRound, predictions, rounds, users]);
  
  const roundPrize = useMemo(() => {
    return selectedRankingRound ? getRoundPrize(selectedRankingRound) : null;
  }, [selectedRankingRound, settings]);

  // Utilitário de timestamp de rodada para ordenação/filtragem
  const roundToTimestamp = (r) => {
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

  // Lista de rodadas finalizadas com ordenação cronológica (mais recente primeiro)
  const finishedRoundsAll = useMemo(() => {
    return rounds
      .filter(r => r.status === 'finished')
      .sort((a, b) => (b.number || 0) - (a.number || 0));
  }, [rounds]);

  // Todas as rodadas finalizadas disponíveis para seleção
  const finishedRoundsBase = finishedRoundsAll;

  // Aplicar filtros por data/período
  const filteredFinishedRounds = useMemo(() => {
    const now = Date.now();
    const periodMs = {
      '3m': 1000 * 60 * 60 * 24 * 90,
      '6m': 1000 * 60 * 60 * 24 * 180,
      '12m': 1000 * 60 * 60 * 24 * 365,
      'all': null
    }[finishedPeriod] || null;

    const startTs = finishedStartDate ? new Date(finishedStartDate).getTime() : null;
    const endTs = finishedEndDate ? new Date(finishedEndDate).getTime() : null;
    const periodStart = periodMs ? now - periodMs : null;

    return finishedRoundsBase.filter(r => {
      const ts = roundToTimestamp(r);
      if (periodStart && ts < periodStart) return false;
      if (startTs && ts < startTs) return false;
      if (endTs && ts > endTs) return false;
      return true;
    });
  }, [finishedRoundsBase, finishedStartDate, finishedEndDate, finishedPeriod]);

  // Selecionar automaticamente a rodada mais recente do filtro ao entrar/alterar filtros
  useEffect(() => {
    if (activeTab === 'finished') {
      const latest = filteredFinishedRounds[0];
      if (latest && selectedFinishedRound !== latest.id) {
        setSelectedFinishedRound(latest.id);
      }
    }
  }, [activeTab, filteredFinishedRounds]);

  // Cache do ranking e prêmio para rodadas finalizadas
  const finishedRanking = useMemo(() => {
    return selectedFinishedRound ? getRankingForRound(selectedFinishedRound) : [];
  }, [selectedFinishedRound, predictions, rounds, users]);

  const finishedPrize = useMemo(() => {
    return selectedFinishedRound ? getRoundPrize(selectedFinishedRound) : null;
  }, [selectedFinishedRound, settings]);

  return (
    <div className="min-h-screen page-bg font-body">

      {/* ── Scoreboard header ── */}
      <div className="bg-campo-700 dark:bg-noite-900 transition-colors duration-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          {/* Top row: brand + actions */}
          <div className="flex items-center justify-between py-3.5 border-b border-white/10 dark:border-white/8">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-white/15 dark:bg-campo-600 rounded-lg flex items-center justify-center flex-shrink-0">
                <Trophy size={15} className="text-white dark:text-ouro-500" />
              </div>
              <span className="font-display text-white text-sm" style={{ letterSpacing: '0.18em' }}>BOLÃO BRASILEIRÃO 2026</span>
            </div>
            <div className="flex items-center gap-3">
              {openRounds.length > 0 && (
                <span className="hidden sm:flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-white/15 border border-white/20 text-white dark:bg-campo-600/20 dark:border-campo-500/30 dark:text-campo-300">
                  <span className="w-1.5 h-1.5 bg-white dark:bg-campo-400 rounded-full animate-pulse-dot" />
                  {openRounds.length} aberta{openRounds.length > 1 ? 's' : ''}
                </span>
              )}
              <DarkToggle />
              <button onClick={() => setShowChangePassword(true)} className="flex items-center gap-1.5 text-white/60 hover:text-white text-sm font-medium transition-colors duration-150">
                <Key size={15} /> <span className="hidden sm:inline">Senha</span>
              </button>
              <button onClick={() => { logout(); setView('login'); }} className="flex items-center gap-1.5 text-white/60 hover:text-white text-sm font-medium transition-colors duration-150">
                <LogOut size={15} /> <span className="hidden sm:inline">Sair</span>
              </button>
            </div>
          </div>
          {/* Name / scoreboard row */}
          <div className="py-5">
            <p className="text-white/55 dark:text-noite-600 text-xs font-semibold uppercase" style={{ letterSpacing: '0.22em' }}>Bem-vindo de volta</p>
            <h1 className="font-display text-white mt-1 leading-none" style={{ fontSize: 'clamp(32px, 5vw, 52px)', letterSpacing: '0.06em' }}>
              {currentUser.name.toUpperCase()}
            </h1>
          </div>
        </div>
      </div>

      {/* ── Tab navigation ── */}
      <div className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex overflow-x-auto pb-px scrollbar-hide">
            {['predictions', 'ranking', 'finished', 'history'].map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} className={`flex-shrink-0 relative py-3.5 px-4 sm:px-5 text-sm font-semibold whitespace-nowrap border-b-2 flex items-center gap-2 transition-all duration-200 ${
                activeTab === tab
                  ? 'border-campo-600 text-campo-700'
                  : 'border-transparent text-noite-400 hover:text-noite-700 hover:border-noite-200'
              }`}>
                {tab === 'predictions' && <><Target size={15} />Palpites</>}
                {tab === 'ranking' && <><TrendingUp size={15} />Ranking</>}
                {tab === 'finished' && <>
                  <Calendar size={15} />Finalizadas
                  {finishedRoundsBase.length > 0 && (
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${activeTab === tab ? 'bg-campo-100 text-campo-700' : 'bg-ouro-100 text-ouro-700'}`}>
                      {finishedRoundsBase.length}
                    </span>
                  )}
                </>}
                {tab === 'history' && <><History size={15} />Minhas Rodadas</>}
              </button>
            ))}
            <button onClick={() => setShowRulesModal(true)} className="ml-auto py-3.5 px-4 sm:px-5 text-sm font-medium whitespace-nowrap border-b-2 border-transparent text-noite-400 hover:text-noite-700 hover:border-noite-200 flex items-center gap-2 transition-all duration-200">
              <FileText size={15} />Regras
            </button>
          </div>
        </div>
      </div>

      {showRulesModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-modal animate-slide-up">
            <div className="p-6 border-b flex justify-between items-center">
              <div className="flex items-center gap-3">
                <FileText className="text-campo-600" size={24} />
                <h3 className="font-display text-2xl text-noite-900" style={{ letterSpacing: '0.04em' }}>REGRAS DO BOLÃO</h3>
              </div>
              <button onClick={() => setShowRulesModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={24} /></button>
            </div>
            <div className="p-6"><RulesCard /></div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {activeTab === 'predictions' && (
          <div className="space-y-10">

            {/* — Rodadas Abertas — apostas permitidas */}
            <div>
              <h2 className="text-2xl font-bold mb-2">Rodadas Abertas</h2>
              <p className="text-gray-600 mb-6">Rodadas disponíveis para palpites agora • R$ {settings?.betValue?.toFixed(2) || '15,00'} por participação</p>
              {openRoundsForBetting.length === 0 ? (
                <div className="bg-white rounded-xl p-12 text-center border-2 border-dashed">
                  <Calendar className="mx-auto text-gray-400 mb-4" size={48} />
                  <h3 className="text-xl font-semibold mb-2">Nenhuma rodada aberta no momento</h3>
                  <p className="text-gray-500 text-sm">Confira as próximas rodadas abaixo.</p>
                </div>
              ) : (
                <div className="grid gap-4">
                  {openRoundsForBetting.map((round) => {
                    const userCartelas = getUserCartelasForRound(round.id);
                    return (
                      <div key={round.id} className="bg-white rounded-xl shadow-sm border p-6">
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="text-xl font-bold">{round.name}</h3>
                              <span className="bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5 rounded-full">✅ Aberta</span>
                            </div>
                            <p className="text-gray-600">{round.matches?.length || 0} jogos • R$ {settings?.betValue?.toFixed(2) || '15,00'} por participação</p>
                          </div>
                          <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                            <button
                              onClick={() => handleStartPrediction(round)}
                              className="w-full sm:w-auto justify-center flex items-center gap-2 bg-green-600 text-white px-4 sm:px-6 py-3 rounded-lg font-medium hover:bg-green-700"
                            >
                              <Plus size={20} />
                              Nova Participação
                            </button>
                            {(() => {
                              const pendingCartelas = (getUserCartelasForRound(round.id) || []).filter(c => !c.paid);
                              const pendingCodes = pendingCartelas.map(c => c.code);
                              const totalAmount = (settings?.betValue || 15) * pendingCartelas.length;
                              const disabled = pendingCartelas.length === 0 || !!paymentLocks[round.id] || !!paymentModalOpen;
                              return (
                                <button
                                  onClick={() => openPaymentForRound(round, pendingCodes, totalAmount)}
                                  disabled={disabled}
                                  className={`w-full sm:w-auto justify-center flex items-center gap-2 px-4 sm:px-6 py-3 rounded-lg font-semibold focus:outline-none focus:ring-2 ${disabled ? 'bg-gray-300 text-gray-600 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-400'}`}
                                  aria-label={`Efetuar pagamento da rodada ${round.name} no valor de ${fmtBRL(totalAmount)}`}
                                >
                                  <DollarSign size={20} />
                                  {paymentLocks[round.id] ? 'Processando...' : 'Efetuar Pagamento da Rodada'}
                                  {!disabled && <span> • {fmtBRL(totalAmount)}</span>}
                                </button>
                              );
                            })()}
                          </div>
                        </div>

                        {userCartelas.length > 0 && (
                          <div className="mt-4 pt-4 border-t">
                            <h4 className="text-sm font-semibold text-gray-700 mb-3">
                              Suas Participações ({userCartelas.length})
                            </h4>
                            <div className="grid gap-2">
                              {userCartelas.map((cartela, index) => {
                                const est = establishments.find(e => e.id === cartela.establishmentId);
                                return (
                                  <div key={cartela.code} className="bg-gray-50 p-3 rounded-lg flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                      <div className="bg-blue-600 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm">
                                        {index + 1}
                                      </div>
                                      <div>
                                        <button
                                          onClick={() => setCartelaDetails({ round, cartela })}
                                          className="font-mono text-sm font-bold text-blue-700 hover:underline"
                                          title="Ver detalhes da cartela"
                                        >
                                          {cartela.code}
                                        </button>
                                        <div className="flex items-center gap-2">
                                          <p className="text-xs text-gray-600">{cartela.predictions.length} palpites</p>
                                          {est && (
                                            <span className="text-xs text-orange-600 flex items-center gap-1">
                                              <Store size={12} /> {est.name}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${cartela.paid ? 'bg-green-600 text-white' : 'bg-orange-100 text-orange-700'}`}>
                                        {cartela.paid ? '💰 Pago' : '⚠️ Pendente'}
                                      </span>
                                      {!cartela.paid && (
                                        <button
                                          onClick={() => handleDeleteCartela(round.id, cartela.code)}
                                          className="px-2 py-1 border rounded-lg text-xs text-red-700 hover:bg-red-50 flex items-center gap-1"
                                          title="Excluir cartela"
                                        >
                                          <Trash2 size={14} /> Excluir
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                              <p className="text-sm text-blue-800">
                                <strong>Total a pagar:</strong> R$ {(userCartelas.length * (settings?.betValue || 15)).toFixed(2)}
                                {userCartelas.filter(c => !c.paid).length > 0 && (
                                  <span className="ml-2 text-orange-700">
                                    • {userCartelas.filter(c => !c.paid).length} pendente(s)
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* — Jogos em Andamento — placar ao vivo para rodadas fechadas */}
            {closedRoundsActive.length > 0 && (
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-2xl font-bold">Jogos em Andamento</h2>
                  <span className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full bg-red-100 text-red-700">
                    <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                    Ao Vivo
                  </span>
                </div>
                <p className="text-gray-500 text-sm mb-5">Placares atualizados automaticamente a cada 5 minutos</p>
                <div className="space-y-4">
                  {closedRoundsActive.map(round => {
                    const totalM = round.matches?.length || 0;
                    const doneM = round.matches?.filter(m => isMatchEffectivelyFinished(m)).length || 0;
                    const liveM = round.matches?.filter(m => !isMatchEffectivelyFinished(m) && m.homeScore !== null).length || 0;
                    return (
                      <div key={round.id} className="bg-white rounded-2xl shadow-sm border overflow-hidden">
                        {/* Header da rodada */}
                        <div className="flex items-center justify-between px-5 py-3.5 border-b bg-gray-50">
                          <div className="flex items-center gap-3">
                            <span className="font-bold text-gray-900">{round.name}</span>
                            {liveM > 0 && (
                              <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                                <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />{liveM} ao vivo
                              </span>
                            )}
                            {doneM > 0 && (
                              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">{doneM} finalizado{doneM > 1 ? 's' : ''}</span>
                            )}
                          </div>
                          <span className="text-xs text-gray-400">{doneM}/{totalM} jogos</span>
                        </div>

                        {/* Lista de jogos */}
                        <div className="divide-y">
                          {[...(round.matches || [])].sort(sortMatchesByDate).map((match, idx) => {
                            const homeTeam = teams.find(t => t.id === match.homeTeamId);
                            const awayTeam = teams.find(t => t.id === match.awayTeamId);
                            const hasScore = match.homeScore !== null && match.awayScore !== null;
                            const isLive = hasScore && !isMatchEffectivelyFinished(match);
                            const isDone = hasScore && isMatchEffectivelyFinished(match);

                            return (
                              <div key={idx} className={`flex items-center px-5 py-3 gap-3 ${isLive ? 'bg-red-50/40' : ''}`}>
                                {/* Casa */}
                                <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
                                  <span className="text-sm font-semibold text-gray-800 truncate text-right">{homeTeam?.name || match.homeTeamName}</span>
                                  <img src={getSafeLogo(homeTeam || { logo: match.homeTeamLogo, name: match.homeTeamName })} alt="" className="w-7 h-7 object-contain flex-shrink-0" />
                                </div>

                                {/* Placar central */}
                                <div className="flex-shrink-0 flex flex-col items-center w-24">
                                  {hasScore ? (
                                    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono font-bold text-lg ${isDone ? 'bg-green-600 text-white' : 'bg-red-500 text-white'}`}>
                                      <span>{match.homeScore}</span>
                                      <span className="text-white/60 text-sm">–</span>
                                      <span>{match.awayScore}</span>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-100 text-gray-400 font-bold text-sm">
                                      <span>?</span><span>–</span><span>?</span>
                                    </div>
                                  )}
                                  <span className={`text-[10px] font-semibold mt-1 ${isDone ? 'text-green-600' : isLive ? 'text-red-500' : 'text-gray-400'}`}>
                                    {isDone ? '✅ FIM' : isLive ? '🔴 AO VIVO' : '⏰ EM BREVE'}
                                  </span>
                                </div>

                                {/* Visitante */}
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <img src={getSafeLogo(awayTeam || { logo: match.awayTeamLogo, name: match.awayTeamName })} alt="" className="w-7 h-7 object-contain flex-shrink-0" />
                                  <span className="text-sm font-semibold text-gray-800 truncate">{awayTeam?.name || match.awayTeamName}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* — Próximas Rodadas — somente visualização */}
            {upcomingRoundsForView.length > 0 && (
              <div>
                <h2 className="text-2xl font-bold mb-2">Próximas Rodadas</h2>
                <p className="text-gray-600 mb-6">Confira os jogos. Os palpites serão liberados quando cada rodada for aberta.</p>
                <div className="grid gap-4">
                  {upcomingRoundsForView.map((round) => {
                    const firstMatchDate = round.matches
                      ?.map(m => m.date)
                      .filter(Boolean)
                      .sort()[0];
                    return (
                      <div key={round.id} className="bg-white rounded-xl shadow-sm border p-6 opacity-90">
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="text-xl font-bold">{round.name}</h3>
                              <span className="bg-gray-100 text-gray-600 text-xs font-semibold px-2 py-0.5 rounded-full">🔜 Em breve</span>
                            </div>
                            <p className="text-gray-500 text-sm">
                              {round.matches?.length || 0} jogos
                              {firstMatchDate && ` • Inicia em ${formatDateTime(firstMatchDate)}`}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 text-gray-400">
                            <Clock size={20} />
                            <span className="text-sm font-medium">Aguardando abertura</span>
                          </div>
                        </div>

                        {round.matches?.length > 0 && (
                          <div className="mt-2 space-y-2">
                            {[...round.matches].sort(sortMatchesByDate).slice(0, 5).map((match, idx) => (
                              <div key={idx} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2 text-sm text-gray-700">
                                <span className="font-medium w-2/5 text-right">{match.homeTeamName}</span>
                                <span className="text-gray-400 mx-3 font-bold">×</span>
                                <span className="font-medium w-2/5 text-left">{match.awayTeamName}</span>
                              </div>
                            ))}
                            {round.matches.length > 5 && (
                              <p className="text-xs text-gray-400 text-center pt-1">
                                + {round.matches.length - 5} jogo(s) a confirmar
                              </p>
                            )}
                          </div>
                        )}

                        <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-dashed border-gray-300 text-center">
                          <p className="text-sm text-gray-500">Palpites liberados quando a rodada for aberta pelo administrador</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </div>
        )}

        {activeTab === 'ranking' && (
          <div>
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-2xl font-bold">Ranking</h2>
                <p className="text-gray-600 mt-1">Classificação por rodada • Premiação: 85%</p>
              </div>
              <div className="w-64">
                <label className="block text-sm font-medium mb-2">Selecione a Rodada</label>
                <select
                  value={selectedRankingRound || ''}
                  onChange={(e) => setSelectedRankingRound(e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg bg-white"
                >
                  {rankableRounds.length === 0 && (
                    <option value="">Nenhuma rodada fechada ou finalizada</option>
                  )}
                  {rankableRounds.map(round => (
                    <option key={round.id} value={round.id}>
                      {round.name} {round.status === 'closed' ? '• Parcial' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {!selectedRankingRound || rankableRounds.length === 0 ? (
              <div className="bg-white rounded-xl p-12 text-center border-2 border-dashed">
                <Trophy className="mx-auto text-gray-400 mb-4" size={48} />
                <h3 className="text-xl font-semibold mb-2">Nenhuma rodada fechada ou finalizada</h3>
                <p className="text-gray-500">O ranking aparece para rodadas fechadas (parcial) e finalizadas (final)</p>
              </div>
            ) : (
              <div className="space-y-6">
                {roundPrize && roundPrize.winners.length > 0 && (
                  <div className="bg-gradient-to-br from-yellow-400 via-yellow-500 to-orange-500 rounded-xl p-8 text-white">
                    <div className="flex items-center gap-3 mb-6">
                      <Trophy size={48} />
                      <div>
                        <h3 className="text-3xl font-bold">Premiação (85%)</h3>
                        <p className="text-yellow-100">
                          {roundPrize.winners.length > 1 ? `${roundPrize.winners.length} Vencedores (Empate)` : 'Campeão da Rodada'}
                        </p>
                      </div>
                    </div>

                    <div className="bg-white bg-opacity-20 rounded-xl p-6 mb-6">
                      <div className="text-center">
                        <p className="text-yellow-100 text-sm font-medium">PRÊMIO {roundPrize.winners.length > 1 ? 'POR VENCEDOR' : 'TOTAL'}</p>
                        <p className="text-5xl font-bold mt-2">R$ {roundPrize.prizePerWinner.toFixed(2)}</p>
                        <p className="text-yellow-100 text-sm mt-2">
                          Total arrecadado: R$ {roundPrize.totalPaid.toFixed(2)} | Premiação: R$ {roundPrize.prizePool.toFixed(2)}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {roundPrize.winners.map((winner) => {
                        const est = establishments.find(e => e.id === winner.establishmentId);
                        return (
                          <div key={`${winner.user.id}-${winner.cartelaCode}`} className="bg-white rounded-lg p-4 text-gray-900 flex justify-between items-center">
                            <div className="flex items-center gap-3">
                              <Trophy className="text-yellow-500" size={32} />
                              <div>
                                <p className="font-bold text-xl">{winner.user.name}</p>
                                <p className="text-sm text-gray-600">{winner.user.whatsapp}</p>
                                <p className="text-xs text-blue-600 font-mono">🎫 {winner.cartelaCode}</p>
                                {est && (
                                  <p className="text-xs text-orange-600 flex items-center gap-1 mt-1">
                                    <Store size={12} /> {est.name}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-3xl font-bold text-green-600">{winner.points} pts</p>
                              <p className="text-lg font-bold text-green-700">+ R$ {roundPrize.prizePerWinner.toFixed(2)}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {roundPrize.winners.length > 1 && (
                      <div className="bg-white bg-opacity-20 rounded-xl p-4 text-center mt-4">
                        <p className="text-sm">⚠️ Empate detectado! Premiação dividida igualmente.</p>
                      </div>
                    )}
                  </div>
                )}

                <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                  <div className="bg-gradient-to-r from-green-600 to-green-700 text-white p-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <h3 className="font-bold text-lg">
                        {rounds.find(r => r.id === selectedRankingRound)?.name}
                      </h3>
                      {(() => {
                        const selRound = rounds.find(r => r.id === selectedRankingRound);
                        const liveMatches = selRound?.matches?.filter(m => !m.finished && m.homeScore !== null) || [];
                        if (liveMatches.length > 0) {
                          return (
                            <span className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-red-500 text-white">
                              <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                              AO VIVO • atualiza a cada 5 min
                            </span>
                          );
                        }
                        if (selRound?.status === 'closed') {
                          return <span className="text-xs text-yellow-200 font-medium">Aguardando placares</span>;
                        }
                        return null;
                      })()}
                    </div>
                    <p className="text-sm text-green-100 mt-1">⚠️ Apenas palpites pagos • Pontos parciais incluem jogos em andamento</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[500px]">
                      <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase">Posição</th>
                        <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase">Participante</th>
                        <th className="px-6 py-4 text-center text-xs font-medium text-gray-500 uppercase">Pontos</th>
                        <th className="px-6 py-4 text-center text-xs font-medium text-gray-500 uppercase">Premiação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {ranking.map((item, index) => {
                        const isWinner = roundPrize && roundPrize.winners.some(w => w.user.id === item.user.id && w.cartelaCode === item.cartelaCode);
                        
                        // Calcular posição considerando empates
                        let position = 1;
                        let uniqueScores = [];
                        
                        // Coletar pontuações únicas maiores que a pontuação atual
                        for (let i = 0; i < ranking.length; i++) {
                          if (ranking[i].points > item.points && !uniqueScores.includes(ranking[i].points)) {
                            uniqueScores.push(ranking[i].points);
                          }
                        }
                        
                        // A posição é o número de pontuações únicas maiores + 1
                        position = uniqueScores.length + 1;
                        
                        const est = establishments.find(e => e.id === item.establishmentId);
                        
                        return (
                          <tr
                            key={`${item.user.id}-${item.cartelaCode}`}
                            onClick={() => openRankingCartelaDetails(selectedRankingRound, item)}
                            className={`cursor-pointer hover:bg-gray-50 ${item.user.id === currentUser.id ? 'bg-green-50' : ''} ${isWinner ? 'bg-yellow-50' : ''}`}
                          >
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2">
                                <span className="text-lg font-bold">{position}º</span>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div>
                                <span className="font-medium">{item.user.name}</span>
                                {item.user.id === currentUser.id && (
                                  <span className="ml-2 bg-green-600 text-white text-xs px-2 py-1 rounded-full">Você</span>
                                )}
                                {isWinner && (
                                  <span className="ml-2 bg-yellow-500 text-white text-xs px-2 py-1 rounded-full">Vencedor</span>
                                )}
                                <p className="text-xs text-blue-600 font-mono mt-1">🎫 {item.cartelaCode}</p>
                                {est && (
                                  <p className="text-xs text-orange-600 flex items-center gap-1 mt-1">
                                    <Store size={12} /> {est.name}
                                  </p>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4 text-center">
                              <span className="text-xl font-bold text-green-600">{item.points}</span>
                            </td>
                            <td className="px-6 py-4 text-center">
                              {isWinner && roundPrize ? (
                                <span className="text-lg font-bold text-green-600">R$ {roundPrize.prizePerWinner.toFixed(2)}</span>
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
                  
                  {ranking.length === 0 && (
                    <div className="p-12 text-center">
                      <Users className="mx-auto text-gray-400 mb-4" size={48} />
                      <h3 className="text-xl font-semibold mb-2">Nenhum participante pagou ainda</h3>
                      <p className="text-gray-500">Apenas participantes com pagamento confirmado aparecem no ranking</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'finished' && (
          <div className="transition-opacity">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-2xl font-bold">Rodadas Finalizadas</h2>
                <p className="text-gray-600 mt-1">Ranking de rodadas antigas • Filtre por período</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 w-full md:w-auto">
                <div>
                  <label className="block text-sm font-medium mb-1">Período</label>
                  <select
                    value={finishedPeriod}
                    onChange={(e) => setFinishedPeriod(e.target.value)}
                    className="w-full px-4 py-2 border rounded-lg bg-white"
                    title="Selecione um período rápido (3, 6, 12 meses ou todos)"
                  >
                    <option value="all">Todos</option>
                    <option value="3m">Últimos 3 meses</option>
                    <option value="6m">Últimos 6 meses</option>
                    <option value="12m">Últimos 12 meses</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Início</label>
                  <input
                    type="date"
                    value={finishedStartDate}
                    onChange={(e) => setFinishedStartDate(e.target.value)}
                    className="w-full px-4 py-2 border rounded-lg bg-white"
                    title="Data inicial para filtrar rodadas finalizadas"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Fim</label>
                  <input
                    type="date"
                    value={finishedEndDate}
                    onChange={(e) => setFinishedEndDate(e.target.value)}
                    className="w-full px-4 py-2 border rounded-lg bg-white"
                    title="Data final para filtrar rodadas finalizadas"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-between items-start mb-6">
              <div className="w-64">
                <label className="block text-sm font-medium mb-2">Selecione a Rodada</label>
                <select
                  value={selectedFinishedRound || ''}
                  onChange={(e) => setSelectedFinishedRound(e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg bg-white"
                  title="Escolha a rodada finalizada para ver o ranking"
                >
                  {filteredFinishedRounds.length === 0 && (
                    <option value="">Nenhuma rodada finalizada</option>
                  )}
                  {filteredFinishedRounds.map((round) => (
                    <option key={round.id} value={round.id}>
                      {round.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setFinishedStartDate(''); setFinishedEndDate(''); setFinishedPeriod('all'); }}
                  className="px-4 py-2 border rounded-lg bg-white hover:bg-gray-50"
                  title="Limpar filtros aplicados"
                >
                  Limpar filtros
                </button>
              </div>
            </div>

            {!selectedFinishedRound || filteredFinishedRounds.length === 0 ? (
              <div className="bg-white rounded-xl p-12 text-center border-2 border-dashed">
                <Trophy className="mx-auto text-gray-400 mb-4" size={48} />
                <h3 className="text-xl font-semibold mb-2">Nenhuma rodada finalizada</h3>
                <p className="text-gray-500">Use os filtros acima para encontrar rodadas antigas</p>
              </div>
            ) : (
              <div className="space-y-6">
                {finishedPrize && finishedPrize.winners.length > 0 && (
                  <div className="bg-gradient-to-br from-yellow-400 via-yellow-500 to-orange-500 rounded-xl p-8 text-white">
                    <div className="flex items-center gap-3 mb-6">
                      <Trophy size={28} />
                      <h3 className="text-2xl font-bold">Premiação</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="bg-white/10 rounded-lg p-4">
                        <p className="text-sm text-yellow-100">Total Pago</p>
                        <p className="text-2xl font-bold">R$ {finishedPrize.totalPaid.toFixed(2)}</p>
                      </div>
                      <div className="bg-white/10 rounded-lg p-4">
                        <p className="text-sm text-yellow-100">Premiação (85%)</p>
                        <p className="text-2xl font-bold">R$ {finishedPrize.prizePool.toFixed(2)}</p>
                      </div>
                      <div className="bg-white/10 rounded-lg p-4">
                        <p className="text-sm text-yellow-100">Por vencedor</p>
                        <p className="text-2xl font-bold">R$ {finishedPrize.prizePerWinner.toFixed(2)}</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="bg-white rounded-xl overflow-hidden shadow">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[500px]">
                      <thead>
                        <tr className="bg-gray-50">
                        <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase">Participante</th>
                        <th className="px-6 py-4 text-center text-xs font-medium text-gray-500 uppercase">Cartela</th>
                        <th className="px-6 py-4 text-center text-xs font-medium text-gray-500 uppercase">Estabelecimento</th>
                        <th className="px-6 py-4 text-center text-xs font-medium text-gray-500 uppercase">Pontos</th>
                        <th className="px-6 py-4 text-center text-xs font-medium text-gray-500 uppercase">Premiação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {finishedRanking.map((item) => {
                        const isWinner = finishedPrize && finishedPrize.winners.some(w => w.user.id === item.user.id && w.cartelaCode === item.cartelaCode);
                        const establishment = establishments.find(e => e.id === item.establishmentId);
                        return (
                          <tr key={`${item.user.id}-${item.cartelaCode}`}>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-green-100 text-green-700 flex items-center justify-center font-bold">
                                  {item.user.name?.charAt(0) || '?'}
                                </div>
                                <div>
                                  <p className="font-medium">{item.user.name}</p>
                                  <p className="text-xs text-gray-500">{item.user.whatsapp}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-center">
                              <span className="font-mono text-sm bg-blue-100 text-blue-700 px-2 py-1 rounded">{item.cartelaCode}</span>
                            </td>
                            <td className="px-6 py-4 text-center">
                              {establishment ? (
                                <span className="text-sm font-medium text-orange-600" title="Estabelecimento vinculador da cartela">{establishment.name}</span>
                              ) : (
                                <span className="text-xs text-gray-400">Nenhum</span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-center">
                              <span className="text-xl font-bold text-green-600">{item.points}</span>
                            </td>
                            <td className="px-6 py-4 text-center">
                              {isWinner && finishedPrize ? (
                                <span className="text-lg font-bold text-green-600">R$ {finishedPrize.prizePerWinner.toFixed(2)}</span>
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

                  {finishedRanking.length === 0 && (
                    <div className="p-12 text-center">
                      <Users className="mx-auto text-gray-400 mb-4" size={48} />
                      <h3 className="text-xl font-semibold mb-2">Nenhum participante pagou ainda</h3>
                      <p className="text-gray-500">Apenas participantes com pagamento confirmado aparecem no ranking</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div>
            <h2 className="text-2xl font-bold mb-2">Minhas Rodadas</h2>
            <p className="text-gray-600 mb-6">Veja apenas as rodadas em que você já participa</p>

            {myOpenOrUpcomingRounds.length === 0 && myClosedRounds.length === 0 && myFinishedRounds.length === 0 ? (
              <div className="bg-white rounded-xl p-12 text-center border-2 border-dashed">
                <Calendar className="mx-auto text-gray-400 mb-4" size={48} />
                <h3 className="text-xl font-semibold mb-2">Você ainda não participa de nenhuma rodada</h3>
                <p className="text-gray-500">Vá em "Rodadas Disponíveis" para entrar em uma rodada</p>
              </div>
            ) : (
              <div className="space-y-8">
                {myOpenOrUpcomingRounds.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-sm">
                        {myOpenOrUpcomingRounds.length}
                      </span>
                      Rodadas Ativas
                    </h3>
                    <div className="space-y-3">
                      {myOpenOrUpcomingRounds.map(round => <RoundAccordion key={round.id} round={round} />)}
                    </div>
                  </div>
                )}

                {myClosedRounds.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <span className="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full text-sm">
                        {myClosedRounds.length}
                      </span>
                      Rodadas Aguardando Resultados
                    </h3>
                    <div className="space-y-3">
                      {myClosedRounds.map(round => <RoundAccordion key={round.id} round={round} />)}
                    </div>
                  </div>
                )}

                {myFinishedRounds.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <span className="bg-purple-100 text-purple-700 px-3 py-1 rounded-full text-sm">
                        {myFinishedRounds.length}
                      </span>
                      Rodadas Finalizadas
                    </h3>
                    <div className="space-y-3">
                      {myFinishedRounds.map(round => <RoundAccordion key={round.id} round={round} />)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {selectedRound && <PredictionForm round={selectedRound} initialPredictions={editingPredictions} />}
      {showConfirmModal && pendingPredictions && (
        <ConfirmModal 
          round={pendingPredictions.round} 
          predictionsData={pendingPredictions.predictions}
          cartelaCode={pendingPredictions.cartelaCode}
          establishmentId={pendingPredictions.establishmentId}
          onConfirm={confirmAndSave} 
          onCancel={() => { setShowConfirmModal(false); setEditingPredictions(pendingPredictions.predictions); }} 
        />
      )}
      {cartelaDetails && (
        <CartelaDetailsModal
          round={cartelaDetails.round}
          cartela={cartelaDetails.cartela}
          onClose={() => setCartelaDetails(null)}
        />
      )}
      {paymentModalOpen && paymentContext && (
        <PaymentModal
          open={paymentModalOpen}
          onClose={() => { if (paymentContext?.roundId) setPaymentLocks(prev => ({ ...prev, [paymentContext.roundId]: false })); setPaymentModalOpen(false); setPaymentContext(null); }}
          context={paymentContext}
          currentUser={currentUser}
          onStart={() => { /* lock already set on open */ }}
          onApproved={() => { if (paymentContext?.roundId) setPaymentLocks(prev => ({ ...prev, [paymentContext.roundId]: false })); }}
          onError={() => { if (paymentContext?.roundId) setPaymentLocks(prev => ({ ...prev, [paymentContext.roundId]: false })); }}
        />
      )}
      {showChangePassword && <ChangeMyPasswordModal onClose={() => setShowChangePassword(false)} />}
    </div>
  );
};

const ChangeMyPasswordModal = ({ onClose }) => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!current) { setError('Informe a senha atual'); return; }
    if (next.length < 6) { setError('A nova senha deve ter no mínimo 6 caracteres'); return; }
    if (next !== confirm) { setError('A confirmação não confere'); return; }
    setError(''); setSaving(true);
    try {
      await changeMyPassword(current, next);
      alert('✅ Senha alterada com sucesso!');
      onClose();
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-modal animate-slide-up">
        <div className="p-6 border-b flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Key className="text-campo-600" size={22} />
            <h3 className="font-display text-xl text-noite-900" style={{ letterSpacing: '0.04em' }}>TROCAR MINHA SENHA</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={24} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Senha atual</label>
            <input type={show ? 'text' : 'password'} value={current} onChange={(e) => setCurrent(e.target.value)} className="w-full px-4 py-2 border rounded-lg" placeholder="Sua senha atual (ou a temporária)" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Nova senha</label>
            <input type={show ? 'text' : 'password'} value={next} onChange={(e) => setNext(e.target.value)} className="w-full px-4 py-2 border rounded-lg" placeholder="Mínimo 6 caracteres" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Confirmar nova senha</label>
            <input type={show ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && handleSave()} className="w-full px-4 py-2 border rounded-lg" placeholder="Repita a nova senha" />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Mostrar senhas
          </label>
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
        <div className="p-6 border-t flex gap-3">
          <button onClick={onClose} className="flex-1 px-6 py-2 border rounded-lg">Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 px-6 py-2 bg-green-600 text-white rounded-lg disabled:opacity-60">
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
};

// Tela de Manutenção
const MaintenanceScreen = () => {
  const { settings } = useApp();
  const brand = settings?.brandName || 'Bolão Brasileiro 2026';
  const message = settings?.maintenanceMessage || 'Estamos realizando uma manutenção programada para melhorar sua experiência. Por favor, tente novamente em breve.';
  const untilMs = settings?.maintenanceUntil || null;
  const [remaining, setRemaining] = useState('');
  useEffect(() => {
    if (!untilMs) return;
    const tick = () => {
      const now = Date.now();
      const diff = untilMs - now;
      if (diff <= 0) { setRemaining('Pouco tempo'); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(`${h}h ${m}m ${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [untilMs]);

  return (
    <div className="min-h-screen page-bg font-body flex items-center justify-center p-6 relative overflow-hidden">
      {/* Decorative accent line */}
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-transparent via-campo-500 to-transparent opacity-60 pointer-events-none" />
      <div className="relative z-10 text-center max-w-xl mx-auto animate-fade-in">
        <div className="w-16 h-16 bg-ouro-500/15 border border-ouro-500/30 rounded-2xl flex items-center justify-center mx-auto mb-8">
          <AlertCircle size={30} className="text-ouro-400" style={{ animation: 'pulse 2s ease-in-out infinite' }} />
        </div>
        <p className="text-campo-400 text-xs font-semibold uppercase mb-3" style={{ letterSpacing: '0.3em' }}>Sistema em</p>
        <h1 className="font-display text-white leading-none mb-6" style={{ fontSize: 'clamp(52px, 10vw, 96px)', letterSpacing: '0.06em' }}>
          MANUTENÇÃO
        </h1>
        <p className="text-noite-400 text-base leading-relaxed max-w-md mx-auto font-medium">{message}</p>
        {untilMs && (
          <div className="mt-8 inline-flex flex-col items-center gap-2 bg-white/5 border border-white/10 rounded-2xl px-8 py-5">
            <p className="text-noite-500 text-xs font-semibold uppercase" style={{ letterSpacing: '0.2em' }}>Previsão de retorno</p>
            <p className="font-display text-ouro-400" style={{ fontSize: '2.5rem', letterSpacing: '0.1em' }}>{remaining || '—'}</p>
          </div>
        )}
        <p className="text-noite-700 text-sm mt-8 font-medium">{brand} · Administradores acessam normalmente.</p>
      </div>
    </div>
  );
};

function App() {
  const { currentUser, loading, settings } = useApp();
  const [view, setView] = useState('login');

  useEffect(() => {
    if (currentUser) {
      setView(currentUser.isAdmin ? 'admin' : 'user');
    } else {
      setView('login');
    }
  }, [currentUser]);

  if (loading) {
    return (
      <div className="min-h-screen page-bg flex items-center justify-center font-body">
        <div className="flex flex-col items-center gap-6 animate-fade-in">
          <div className="w-16 h-16 bg-campo-600 rounded-2xl flex items-center justify-center shadow-glow">
            <Trophy size={28} className="text-ouro-500" />
          </div>
          <div className="flex flex-col items-center gap-3">
            <p className="font-display text-white" style={{ fontSize: '2rem', letterSpacing: '0.2em' }}>BOLÃO 2026</p>
            <div className="flex gap-1.5">
              {[0, 1, 2].map(i => (
                <div
                  key={i}
                  className="w-2 h-2 bg-campo-500 rounded-full animate-bounce-in"
                  style={{ animationDelay: `${i * 0.18}s`, animationIterationCount: 'infinite' }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!currentUser || view === 'login') return <LoginScreen setView={setView} />;
  // Gating global: se manutenção estiver ativa, usuários logados não-admin são direcionados à tela de manutenção
  if (settings?.maintenanceMode && (currentUser && !currentUser.isAdmin)) {
    return <MaintenanceScreen />;
  }
  if (currentUser.isAdmin && view === 'admin') return <AdminPanel setView={setView} />;
  if (view === 'user') return <UserPanel setView={setView} />;
  return null;
}

export default function Root() {
  return (
    <AppProvider>
      <App />
    </AppProvider>
  );
}
