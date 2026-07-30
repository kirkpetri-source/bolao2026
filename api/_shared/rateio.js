// Divisão do dinheiro arrecadado nas cartelas.
//
// Duas dívidas pagas aqui:
//
// 1. Os percentuais estavam repetidos em quatro pontos (três no AdminPanel e um
//    em api/ranking/public.js, a página pública que anuncia o prêmio).
//    Percentual copiado é percentual que um dia diverge — e a divergência
//    aparece como prêmio diferente em duas telas, o que gera briga no grupo.
//
// 2. O painel JÁ tinha campos para o organizador escolher a taxa de
//    administração e a comissão do ponto de venda (`betConfig.fees`), salvava os
//    dois... e nenhum cálculo lia. Quem trocasse a taxa para 15% continuaria
//    vendo o sistema dividir 85/10/5. Campo que não muda nada é pior que campo
//    ausente: o organizador acha que decidiu.
//
// O prêmio é o QUE SOBRA, não um número fixo: se a taxa de administração sobe,
// o prêmio desce. Assim as partes sempre fecham em 100% do arrecadado.
//
// Sem dependências: painel, endpoint público e página de venda usam o mesmo
// arquivo, então o número anunciado na venda é o número que o sistema paga.

export const PADRAO_ADMIN_PCT = 10;          // taxa do organizador
export const PADRAO_ESTABELECIMENTO_PCT = 5; // comissão do ponto de venda
export const MAX_ADMIN_PCT = 50;             // acima disso o prêmio vira piada e o bolão morre

function numero(v, padrao) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : padrao;
}

// Devolve os três percentuais coerentes entre si, em pontos percentuais.
// Garante que nenhum deles deixe o prêmio negativo.
export function normalizaPercentuais(adminPct, estabelecimentoPct) {
  const admin = Math.min(numero(adminPct, PADRAO_ADMIN_PCT), MAX_ADMIN_PCT);
  const estabelecimento = Math.min(numero(estabelecimentoPct, PADRAO_ESTABELECIMENTO_PCT), MAX_ADMIN_PCT);
  const premio = Math.max(0, 100 - admin - estabelecimento);
  return { adminPct: admin, estabelecimentoPct: estabelecimento, premioPct: premio };
}

// Lê a escolha do organizador. Bolão que nunca mexeu nas taxas cai no padrão
// histórico (85/10/5), então nada muda para quem já estava rodando.
export function percentuaisDe(settings) {
  const f = settings?.betConfig?.fees || {};
  return normalizaPercentuais(f.adminPercent, f.establishmentPercent);
}

// `cartelasComPontoDeVenda` = quantas cartelas pagas vieram por estabelecimento.
// A comissão incide só sobre elas, não sobre a arrecadação inteira.
export function rateio(totalArrecadado, opcoes = {}) {
  const {
    adminPct, estabelecimentoPct,
    cartelasComPontoDeVenda = 0, valorDaCartela = 0,
  } = opcoes;

  const p = normalizaPercentuais(adminPct, estabelecimentoPct);
  const total = numero(totalArrecadado, 0);

  return {
    total,
    premio: total * (p.premioPct / 100),
    administracao: total * (p.adminPct / 100),
    estabelecimentos: numero(cartelasComPontoDeVenda, 0) * numero(valorDaCartela, 0) * (p.estabelecimentoPct / 100),
    ...p,
  };
}

// Quantas cartelas o bolão precisa vender para a taxa de administração cobrir a
// mensalidade. É a conta que a página de venda mostra ao organizador: com ela,
// ele não tira o valor do próprio bolso.
export function cartelasParaPagarMensalidade(mensalidadeCentavos, valorDaCartela, adminPct = PADRAO_ADMIN_PCT) {
  const valor = numero(valorDaCartela, 0);
  const { adminPct: pct } = normalizaPercentuais(adminPct);
  if (valor <= 0 || pct <= 0) return Infinity;
  const mensalidade = numero(mensalidadeCentavos, 0) / 100;
  return Math.ceil(mensalidade / (valor * (pct / 100)));
}
