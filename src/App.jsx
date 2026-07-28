import React, { useState, useEffect, useRef, createContext, useContext, useMemo } from 'react';
import { Trophy, Users, Calendar, Clock, TrendingUp, LogOut, Eye, EyeOff, Plus, Edit2, Trash2, Upload, ExternalLink, X, UserPlus, Target, Award, ChevronDown, ChevronUp, Check, Key, DollarSign, CheckCircle, XCircle, AlertCircle, FileText, Download, Store, Filter, Loader2, Megaphone, Send, Search, Bell, Copy, RefreshCcw, History, Moon, Sun } from 'lucide-react';
import { collection, addDoc, updateDoc, deleteDoc, doc, setDoc, getDocs, getDoc, onSnapshot, serverTimestamp, query, where, orderBy, limit } from 'firebase/firestore';
import { jsPDF } from 'jspdf';
import axios from 'axios';
import { MESSAGE_TEMPLATES, TEMPLATE_CATEGORIES, buildTemplateText as buildTemplateTextUtil, validateMessageTags, normalizeTags, compileTemplate } from './utils/messageTemplates.js';
import { db, PUBLIC_CONFIG_ID, pickPublicConfig } from './firebase.js';
import { SERIE_A_2026_TEAMS, TENANT_ID } from './constants.js';
import { generateCartelaCode, fmtBRL, sortMatchesByDate, MATCH_FINISH_AFTER_MS, MATCH_IN_PROGRESS_STATUSES, isMatchEffectivelyFinished, getSafeLogo, markdownToHtml } from './utils/helpers.js';
import { AppContext, useApp } from './AppContext.js';
import { RulesCard, DarkToggle } from './components/shared.jsx';
import UserPanel from './UserPanel.jsx';
import AdminPanel from './AdminPanel.jsx';
import { loginWithWhatsapp, registerWithWhatsapp, logout as fbLogout, observeAuth, authErrorMessage, changeOwnPassword, changeMyPassword, adminCreateUser, getIdToken } from './authService.js';


const initializeDatabase = async () => {
  try {
    const usersSnapshot = await getDocs(collection(db, 'users'));
    const teamsSnapshot = await getDocs(collection(db, 'teams'));
    const settingsSnapshot = await getDocs(query(collection(db, 'settings'), where('tenantId', '==', TENANT_ID)));
    
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
        tenantId: TENANT_ID,
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
    const unsub = onSnapshot(query(collection(db, 'establishments'), where('tenantId', '==', TENANT_ID)),
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

    const byTenant = (col) => query(collection(db, col), where('tenantId', '==', TENANT_ID));
    const uns = [
      onSnapshot(byTenant('rounds'), s => setRounds(s.docs.map(d => ({ id: d.id, ...d.data() }))), err => console.error('rounds:', err)),
      onSnapshot(collection(db, 'teams'), s => setTeams(s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name))), err => console.error('teams:', err)),
      onSnapshot(byTenant('predictions'), s => setPredictions(s.docs.map(d => ({ id: d.id, ...d.data() }))), err => console.error('predictions:', err)),
      onSnapshot(collection(db, 'users'), s => setUsers(s.docs.map(d => { const data = d.data(); const { password, ...rest } = data; return { id: d.id, ...rest }; })), err => console.error('users:', err)),
    ];
    if (isAdminUser) {
      uns.push(
        onSnapshot(byTenant('communications'), s => setCommunications(s.docs.map(d => ({ id: d.id, ...d.data() }))), err => console.error('communications:', err)),
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
      unsub = onSnapshot(query(collection(db, 'settings'), where('tenantId', '==', TENANT_ID)), s => {
        const full = s.docs.length > 0 ? { id: s.docs[0].id, ...s.docs[0].data() } : null;
        setSettings(full);
        if (full) {
          setDoc(doc(db, 'public_config', PUBLIC_CONFIG_ID), { ...pickPublicConfig(full), tenantId: TENANT_ID }, { merge: true })
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

      // Duplicidade: melhor esforço (sem login as regras negam a leitura da coleção;
      // a unicidade real vem do Auth, via e-mail sintético derivado do WhatsApp).
      try {
        const usersSnap = await getDocs(collection(db, 'users'));
        const exists = usersSnap.docs.some(doc => normalizeWhatsapp(doc.data().whatsapp) === phone);
        if (exists) throw new Error('WhatsApp já cadastrado!');
      } catch (e) {
        if (e?.message === 'WhatsApp já cadastrado!') throw e;
      }
      if (!d.password) throw new Error('Senha obrigatória para criar usuário.');

      const { password, ...rest } = d;
      const toSave = {
        ...rest,
        whatsapp: phone,
        isAdmin: !!d.isAdmin,
        balance: d.balance || 0,
      };

      if (currentUser?.isAdmin) {
        // Admin logado: cria a conta no Auth (app secundário para não derrubar a
        // sessão) e grava /users + vínculo de membro do tenant como admin/owner.
        const uid = await adminCreateUser({ whatsapp: phone, password: d.password });
        await setDoc(doc(db, 'users', uid), { ...toSave, createdAt: serverTimestamp() });
        await setDoc(doc(db, 'tenants', TENANT_ID, 'members', uid), {
          role: toSave.isAdmin ? 'owner' : 'participant',
          name: toSave.name || '',
          createdAt: serverTimestamp(),
        });
        return { id: uid, ...toSave };
      }

      // Cadastro público (sem login): o app secundário fica autenticado como o novo
      // usuário e grava o próprio doc + auto-vínculo como participante do tenant
      // (as regras permitem create do próprio doc e self-join com role participant).
      const uid = await adminCreateUser({
        whatsapp: phone,
        password: d.password,
        userDoc: { ...toSave, isAdmin: false },
        tenantId: TENANT_ID,
      });
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
    deleteUser: async (id) => {
      requireAdmin();
      try { await deleteDoc(doc(db, 'tenants', TENANT_ID, 'members', id)); } catch (e) { console.warn('remover membro:', e); }
      return await deleteDoc(doc(db, 'users', id));
    },
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
    addRound: async (d) => { requireAdmin(); const r = await addDoc(collection(db, 'rounds'), { ...d, tenantId: TENANT_ID, createdAt: serverTimestamp() }); return { id: r.id, ...d }; },
    updateRound: async (id, d) => { requireAdmin(); return await updateDoc(doc(db, 'rounds', id), d); },
    deleteRound: async (id) => { requireAdmin(); return await deleteDoc(doc(db, 'rounds', id)); },
    addPrediction: async (d) => { 
      if (!currentUser) throw new Error('Não autenticado');
      if (currentUser.id !== d.userId && !currentUser.isAdmin) throw new Error('Não autorizado');
      const r = await addDoc(collection(db, 'predictions'), {
        ...d,
        tenantId: TENANT_ID,
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
    addEstablishment: async (d) => { requireAdmin(); const r = await addDoc(collection(db, 'establishments'), { ...d, tenantId: TENANT_ID, createdAt: serverTimestamp() }); return { id: r.id, ...d }; },
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
    addCommunication: async (d) => { requireAdmin(); const r = await addDoc(collection(db, 'communications'), { ...d, tenantId: TENANT_ID, createdAt: serverTimestamp() }); return { id: r.id, ...d }; },
    updateCommunication: async (id, d) => { requireAdmin(); return await updateDoc(doc(db, 'communications', id), d); }
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
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
