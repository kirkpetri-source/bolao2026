// Resolução do tenant no cliente (Fase 3 do SaaS).
//
// Ordem de resolução ao abrir o app:
//  1. Link de convite `?t=<slug>` na URL — grava e passa a valer.
//  2. Último tenant usado (localStorage).
//  3. Tenant padrão (o bolão original da Lion Tech).
//
// Após o login, o AppProvider pode trocar para o `lastTenantId` gravado no doc
// do usuário (o tenant onde ele se cadastrou por último).
// Mantém em sincronia com api/_shared/tenant.js (backend).

export const DEFAULT_TENANT_ID = 'bolao-lion-tech';

const STORAGE_KEY = 'bb.tenantId';

export function rememberTenant(tid) {
  try { localStorage.setItem(STORAGE_KEY, tid); } catch {}
}

export function resolveTenantId() {
  try {
    const fromUrl = new URL(window.location.href).searchParams.get('t');
    if (fromUrl) { rememberTenant(fromUrl); return fromUrl; }
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
  } catch {}
  return DEFAULT_TENANT_ID;
}

// O tenant padrão continua usando o doc histórico 'main' em /public_config;
// tenants novos usam o próprio slug como ID do doc.
export function publicConfigDocId(tid) {
  return tid === DEFAULT_TENANT_ID ? 'main' : tid;
}

export function inviteUrl(tid) {
  try { return `${window.location.origin}/?t=${encodeURIComponent(tid)}`; }
  catch { return `/?t=${encodeURIComponent(tid)}`; }
}
