// Inicialização única do Firebase no cliente + helpers de configuração pública.
// Centraliza o app/db para todos os módulos do frontend (App.jsx, authService, etc.).
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

// DEV PROJECT — banco isolado. Chaves web do Firebase são públicas por natureza;
// a proteção real vem das regras do Firestore.
const firebaseConfig = {
  apiKey: 'AIzaSyCDEbEF3wQQck2bbIZfW1tCNROJzJ39cXQ',
  authDomain: 'bolao-brasileirao-dev-kd.firebaseapp.com',
  projectId: 'bolao-brasileirao-dev-kd',
  storageBucket: 'bolao-brasileirao-dev-kd.firebasestorage.app',
  messagingSenderId: '1084218540237',
  appId: '1:1084218540237:web:3e9b1d8d194a2e93472984',
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// ─── Separação settings (segredos) x public_config (dados públicos) ───────────
// O admin lê /settings completo (com tokens Woovi/Evolution). O usuário comum lê
// apenas /public_config/main, que espelha os campos públicos SEM segredos.
export const PUBLIC_CONFIG_ID = 'main';

export function pickPublicConfig(s) {
  if (!s) return {};
  return {
    betValue: s.betValue ?? 15,
    brandName: s.brandName ?? '',
    maintenanceMode: !!s.maintenanceMode,
    maintenanceMessage: s.maintenanceMessage ?? '',
    maintenanceUntil: s.maintenanceUntil ?? null,
    maintenanceAllowedIps: s.maintenanceAllowedIps ?? [],
    rulesText: s.rulesText ?? '',
    scoringCriteria: s.scoringCriteria ?? '',
    tiebreakRules: s.tiebreakRules ?? '',
    termsOfUse: s.termsOfUse ?? '',
    systemPolicies: s.systemPolicies ?? '',
    limitsRestrictions: s.limitsRestrictions ?? '',
    // Booleano em vez do appId secreto: o cliente só precisa saber se o Woovi está ativo.
    wooviEnabled: !!(s.woovi?.appId && String(s.woovi.appId).trim()),
    payment: {
      pixKey: s.payment?.pixKey ?? s.pixKey ?? '',
      pixRecipientName: s.payment?.pixRecipientName ?? s.pixRecipientName ?? '',
      methods: s.payment?.methods ?? { pix: true, card: false },
    },
    whatsapp: {
      number: s.whatsapp?.number ?? '',
      groupJid: s.whatsapp?.groupJid ?? '',
    },
  };
}
