// Endereço público do sistema, decidido num lugar só.
//
// Antes cada cron montava o link com `settings.appUrl || process.env.APP_URL`,
// dando PRIORIDADE a um campo gravado no banco por um formulário do painel.
// Com a troca de domínio isso virou armadilha: dois bolões tinham o endereço
// antigo salvo, então os links de WhatsApp saíam no domínio velho mesmo com a
// env correta — e ninguém consegue adivinhar isso olhando o código, porque o
// valor errado está no banco.
//
// Agora o endereço vem SÓ do ambiente. É a mesma informação para todos os
// bolões (é o domínio da plataforma, não do cliente), então não tem por que
// viver em `settings` — e o que não pode divergir, não deve ser copiado.
//
// Sem dependências de propósito: dá para importar em cron, endpoint e teste.

export const DOMINIO_PADRAO = 'https://brasilbolao.com.br';

export function baseUrl(env = process.env) {
  const bruto = String(env?.APP_URL || '').trim();
  return (bruto || DOMINIO_PADRAO).replace(/\/+$/, '');
}

// Endereço do bolão. Cada um tem o seu caminho curto (/meu-bolao) desde que a
// raiz virou porta de entrada: link para a raiz faz o participante cair numa
// tela de "escolha seu bolão", em vez de já estar no dele.
export function tenantUrl(tenantId, env = process.env) {
  const base = baseUrl(env);
  const tid = String(tenantId || '').trim();
  return tid ? `${base}/${encodeURIComponent(tid)}` : base;
}

// Página pública do resultado de uma rodada. Não leva bolão no caminho: o
// endpoint descobre o tenant pela própria rodada.
export function rankingUrl(roundId, env = process.env) {
  return `${baseUrl(env)}/ranking/${encodeURIComponent(String(roundId || '').trim())}`;
}
