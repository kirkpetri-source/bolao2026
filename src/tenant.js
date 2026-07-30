// Resolução do bolão no cliente.
//
// Ordem: caminho da URL (/meu-bolao) > ?t=<slug> (links antigos) > último usado
// (localStorage). Sem nenhum desses, NÃO há bolão: a raiz virou uma página de
// entrada, e não o bolão da plataforma.
//
// Antes a raiz caía no bolão padrão, então quem digitava só o endereço do site
// se cadastrava no bolão de teste da Lion Tech — um bolão sem organizador de
// verdade. Mantém em sincronia com api/_shared/tenant.js (backend).

export const DEFAULT_TENANT_ID = 'bolao-lion-tech';

const STORAGE_KEY = 'bb.tenantId';

// Caminhos do próprio site. Precisa acompanhar as rotas de vercel.json e a
// lista RESERVADOS de api/tenants/create.js, senão um bolão poderia nascer com
// um nome que sequestra uma rota.
export const CAMINHOS_RESERVADOS = new Set([
  '', 'entrar', 'plataforma', 'ranking', 'api', 'assets', 'index.html',
  'version.json', 'favicon.ico', 'robots.txt',
]);

export function rememberTenant(tid) {
  try { localStorage.setItem(STORAGE_KEY, tid); } catch {}
}

export function esquecerTenant() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

// Primeiro trecho do caminho, quando ele parece um bolão.
export function slugDaUrl(href) {
  try {
    const { pathname } = new URL(href || window.location.href);
    const partes = pathname.split('/').filter(Boolean);
    if (partes.length !== 1) return null;           // /ranking/123 não é bolão
    const p = decodeURIComponent(partes[0]).toLowerCase();
    if (CAMINHOS_RESERVADOS.has(p)) return null;
    return /^[a-z0-9-]{3,60}$/.test(p) ? p : null;
  } catch { return null; }
}

// Devolve o bolão pedido na URL, ou null quando a pessoa chegou na raiz.
export function tenantPedidoNaUrl() {
  const doCaminho = slugDaUrl();
  if (doCaminho) return doCaminho;
  try {
    const t = new URL(window.location.href).searchParams.get('t');
    return t ? String(t).toLowerCase() : null;
  } catch { return null; }
}

// O bolão vem SÓ da URL. O último visitado não entra aqui de propósito: quem
// digita a raiz está pedindo a porta de entrada, e mandá-lo direto para um bolão
// guardado no navegador é surpresa — pior ainda em computador compartilhado, em
// que a pessoa cairia no bolão de outro. O atalho para o último bolão aparece na
// tela de entrada, como oferta, não como desvio automático.
export function resolveTenantId() {
  const pedido = tenantPedidoNaUrl();
  if (pedido) { rememberTenant(pedido); return pedido; }
  return null;   // sem bolão na URL: a tela de entrada assume
}

// Último bolão visitado, para a tela de entrada oferecer o atalho.
export function ultimoBolaoVisitado() {
  try { return localStorage.getItem(STORAGE_KEY) || null; } catch { return null; }
}

// O bolão padrão ainda usa o doc histórico 'main' em /public_config.
export function publicConfigDocId(tid) {
  return tid === DEFAULT_TENANT_ID ? 'main' : tid;
}

// Endereço do bolão: curto, sem parâmetro, fácil de ditar por telefone.
export function inviteUrl(tid) {
  try { return `${window.location.origin}/${encodeURIComponent(tid)}`; }
  catch { return `/${tid}`; }
}

// Mensagem pronta para o organizador colar no grupo.
export function inviteMessage(nomeDoBolao, url) {
  return `🏆 *${nomeDoBolao}*\n\n`
    + `Você está convidado para o nosso bolão do Brasileirão!\n\n`
    + `É só entrar pelo link, se cadastrar com seu WhatsApp e fazer os palpites de cada rodada:\n`
    + `${url}\n\n`
    + `Boa sorte! ⚽`;
}

// Mantém a barra de endereço mostrando o bolão aberto.
//
// Sem isto, quem já tinha visitado um bolão abria a raiz e caía nele com a URL
// exibindo só "/" — o mesmo problema de origem: a pessoa não sabe em qual
// bolão está, e não tem como mandar o link certo para um amigo.
export function sincronizarUrlComTenant(tid) {
  if (!tid) return;
  try {
    const atual = window.location.pathname;
    const partes = atual.split('/').filter(Boolean);
    // Não mexe em rotas do site (/plataforma, /ranking/123).
    if (partes.length > 1) return;
    if (partes.length === 1 && CAMINHOS_RESERVADOS.has(partes[0].toLowerCase())) return;
    if (partes[0] === tid) return;
    window.history.replaceState({}, '', `/${tid}${window.location.search || ''}`);
  } catch { /* navegador sem history: só não sincroniza */ }
}
