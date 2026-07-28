// Tenant padrão (Fase 2 do SaaS). Os crons/webhooks hoje operam sobre um único
// tenant; quando o onboarding entrar, passam a iterar a coleção /tenants.
// Mantém em sincronia com src/constants.js (frontend).
export const DEFAULT_TENANT_ID = 'bolao-lion-tech';
