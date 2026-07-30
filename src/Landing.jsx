import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ArrowRight, Check, X, Calendar, Smartphone, BarChart3, QrCode, MessageCircle,
  Share2, ShieldCheck, Wallet, Trophy, Store, DollarSign, Megaphone, Users, Lock,
  Minus, Plus,
} from 'lucide-react';
import { Marca } from './components/Marca.jsx';
import { TRIAL_DAYS, PRICE_CENTS, PROMO_PRICE_CENTS } from '../api/_shared/subscription.js';
import {
  rateio, cartelasParaPagarMensalidade, normalizaPercentuais,
  PADRAO_ADMIN_PCT, PADRAO_ESTABELECIMENTO_PCT, MAX_ADMIN_PCT,
} from '../api/_shared/rateio.js';

// Página de venda — a raiz de brasilbolao.com.br.
//
// O argumento central não é "o sistema é bonito", é ARITMÉTICA: o bolão já
// separa 10% de taxa de administração para o organizador, e essa taxa cobre a
// mensalidade. Somado ao teste de 7 dias — que contém uma rodada inteira do
// Brasileirão —, o organizador arrecada ANTES de pagar qualquer coisa. Foi a
// ideia do Kirk; o mérito dela é que não depende de promessa, depende de conta.
//
// Por isso os percentuais e o preço são IMPORTADOS dos módulos que o sistema
// usa de verdade (_shared/rateio.js, _shared/subscription.js). Se um dia o
// rateio mudar, a página muda junto. Número decorado numa página de venda é
// promessa que o produto não assinou.
//
// Cores literais (bg-[#060912], text-[#e9eef2]) em vez das classes utilitárias:
// o index.css converte bg-white/bg-gray-*/text-noite-* no tema escuro com
// !important, então uma seção que precisa ser escura nos DOIS temas tem de sair
// dessa conversão.

const real = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const realCent = (c) => real(c / 100);

const WHATSAPP_VENDAS = '5564999555364';
const linkWhatsapp = `https://wa.me/${WHATSAPP_VENDAS}?text=${encodeURIComponent('Olá! Quero saber mais sobre o sistema de bolão.')}`;

// O Brasileirão tem rodada semanal, então um mês típico tem quatro. Usado para
// mostrar o mês inteiro na calculadora — e dito na tela, para o número não
// parecer garantia de calendário.
const RODADAS_POR_MES = 4;

// Prints do sistema real. Ficam em /public/prints e entram aqui quando existem:
// lista vazia = a seção não renderiza, então a página nunca mostra imagem
// quebrada enquanto os arquivos não estão no repositório.
const PRINTS = [];

// ─── Aparece ao rolar ─────────────────────────────────────────────────────────
function Revela({ children, delay = 0, className = '' }) {
  const ref = useRef(null);
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setVisivel(true); return; }
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setVisivel(true); obs.disconnect(); }
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}
      style={{
        opacity: visivel ? 1 : 0,
        transform: visivel ? 'none' : 'translateY(18px)',
        transition: `opacity .6s ease ${delay}ms, transform .6s cubic-bezier(.16,1,.3,1) ${delay}ms`,
      }}>
      {children}
    </div>
  );
}

// ─── Exemplo de rodada encerrada ──────────────────────────────────────────────
// Reprodução fiel da tela de resultado: ranking por cartela, pontos pela regra
// real (placar exato 3, vencedor 1) e prêmio calculado pelo MESMO rateio do
// sistema. Substitui a demonstração de palpite, que falava com o participante —
// quem lê esta página é o organizador, e o que o convence é ver o dinheiro
// dividido e o ranking pronto sem ele ter feito nada.
const EXEMPLO = {
  cartelas: 24,
  valor: 15,
  rodada: 'Rodada 21',
  top: [
    { nome: 'Marcos A.', cartela: 'C-07', pontos: 19 },
    { nome: 'Juliana R.', cartela: 'C-12', pontos: 17 },
    { nome: 'Pedro H.', cartela: 'C-03', pontos: 16 },
    { nome: 'Sandro L.', cartela: 'C-21', pontos: 14 },
    { nome: 'Camila F.', cartela: 'C-15', pontos: 13 },
  ],
};

function CartaoResultado() {
  const arrecadado = EXEMPLO.cartelas * EXEMPLO.valor;
  const { premio, administracao, premioPct, adminPct } = rateio(arrecadado);
  const medalhas = ['1', '2', '3', '4', '5'];

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(6px)' }}>
      <div className="px-6 pt-6 pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase" style={{ letterSpacing: '0.16em', color: '#9fb3a6' }}>
              {EXEMPLO.rodada} · encerrada
            </p>
            <p className="font-display text-lg" style={{ color: '#f2f6f3' }}>RANKING DA RODADA</p>
          </div>
          <Trophy size={22} style={{ color: '#FFD700', flexShrink: 0 }} />
        </div>

        <div className="rounded-xl px-4 py-3.5 flex items-center justify-between gap-4"
          style={{ background: 'linear-gradient(90deg, rgba(255,215,0,0.16), rgba(255,215,0,0.05))', border: '1px solid rgba(255,215,0,0.35)' }}>
          <div className="min-w-0">
            <p className="text-[11px] uppercase font-semibold" style={{ letterSpacing: '0.14em', color: '#d9c37a' }}>
              Campeão da rodada
            </p>
            <p className="font-semibold truncate" style={{ color: '#f2f6f3' }}>
              {EXEMPLO.top[0].nome} · {EXEMPLO.top[0].cartela}
            </p>
          </div>
          <p className="font-display flex-shrink-0" style={{ fontSize: '1.7rem', color: '#FFD700', lineHeight: 1 }}>
            {real(premio)}
          </p>
        </div>
      </div>

      <div className="px-6 py-4">
        {EXEMPLO.top.map((c, i) => (
          <div key={c.cartela} className="flex items-center gap-3 py-2.5"
            style={{ borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.06)' }}>
            <span className="w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold flex-shrink-0"
              style={{
                background: i === 0 ? '#FFD700' : 'rgba(255,255,255,0.08)',
                color: i === 0 ? '#0a0f1a' : '#9fb3a6',
              }}>
              {medalhas[i]}
            </span>
            <span className="flex-1 text-sm truncate" style={{ color: i === 0 ? '#f2f6f3' : '#c8d5cc' }}>{c.nome}</span>
            <span className="text-[11px] font-mono flex-shrink-0" style={{ color: '#6f8177' }}>{c.cartela}</span>
            <span className="text-sm font-bold tabular-nums flex-shrink-0 w-8 text-right"
              style={{ color: i === 0 ? '#FFD700' : '#dbe6de' }}>
              {c.pontos}
            </span>
          </div>
        ))}
      </div>

      <div className="px-6 py-4 grid grid-cols-3 gap-3" style={{ background: 'rgba(0,0,0,0.25)', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        {[
          ['Arrecadado', real(arrecadado)],
          [`Prêmio ${premioPct}%`, real(premio)],
          [`Sua taxa ${adminPct}%`, real(administracao)],
        ].map(([rotulo, valor], i) => (
          <div key={rotulo}>
            <p className="text-[10px] uppercase mb-0.5" style={{ letterSpacing: '0.1em', color: '#6f8177' }}>{rotulo}</p>
            <p className="text-sm font-semibold tabular-nums" style={{ color: i === 2 ? '#34d375' : '#dbe6de' }}>{valor}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Controle de faixa ────────────────────────────────────────────────────────
// FORA da Calculadora de propósito. Declarado dentro dela, o React tratava cada
// render como um tipo de componente NOVO e remontava o <input>: o arraste
// morria no primeiro pixel, porque o elemento sob o dedo/cursor era destruído
// e recriado. Só o clique na trilha funcionava. Componente declarado dentro de
// outro componente é sempre isso — identidade nova a cada render.
function Faixa({ rotulo, valor, min, max, passo, set, formata, sufixo }) {
  const pct = ((valor - min) / (max - min)) * 100;
  const ajusta = (delta) => () => set(Math.max(min, Math.min(max, valor + delta)));

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2 gap-3">
        <label htmlFor={`faixa-${rotulo}`} className="text-sm" style={{ color: '#b9c9bf' }}>{rotulo}</label>
        <span className="font-display tabular-nums whitespace-nowrap" style={{ color: '#FFD700', fontSize: '1.35rem' }}>
          {formata(valor)}{sufixo}
        </span>
      </div>

      <div className="flex items-center gap-2.5">
        {/* Os botões ficam para ajuste fino e para quem usa teclado ou tem
            dificuldade com arraste — não substituem o arraste, somam a ele. */}
        <button type="button" onClick={ajusta(-passo)} aria-label={`Diminuir ${rotulo}`}
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors"
          style={{ background: 'rgba(255,255,255,0.07)', color: '#cfe6d6' }}>
          <Minus size={15} />
        </button>

        <input id={`faixa-${rotulo}`} type="range" min={min} max={max} step={passo} value={valor}
          onChange={(e) => set(Number(e.target.value))}
          className="bb-faixa flex-1"
          style={{ background: `linear-gradient(90deg, #FFD700 ${pct}%, rgba(255,255,255,0.13) ${pct}%)` }}
          aria-valuetext={`${formata(valor)}${sufixo || ''}`} />

        <button type="button" onClick={ajusta(passo)} aria-label={`Aumentar ${rotulo}`}
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors"
          style={{ background: 'rgba(255,255,255,0.07)', color: '#cfe6d6' }}>
          <Plus size={15} />
        </button>
      </div>
    </div>
  );
}

// ─── Calculadora: o bolão paga o sistema ──────────────────────────────────────
function Calculadora({ onCriar }) {
  const [participantes, setParticipantes] = useState(24);
  const [valor, setValor] = useState(15);
  // A taxa é escolha do organizador nas Configurações do painel — a barra aqui
  // simula exatamente esse campo, não um número nosso.
  const [taxa, setTaxa] = useState(PADRAO_ADMIN_PCT);

  const conta = useMemo(() => {
    const arrecadado = participantes * valor;
    const opcoes = { adminPct: taxa, estabelecimentoPct: PADRAO_ESTABELECIMENTO_PCT };
    const { premio, administracao, premioPct } = rateio(arrecadado, opcoes);
    const mensalidade = PROMO_PRICE_CENTS / 100;
    return {
      arrecadado,
      premio,
      premioPct,
      administracao,
      mensalidade,
      // A mensalidade é uma vez por MÊS e a rodada é toda semana: só a primeira
      // rodada do mês carrega o desconto. Nas outras, a taxa inteira é do
      // organizador. Esconder isso subestimava o produto na própria página.
      sobra: administracao - mensalidade,
      noMes: administracao * RODADAS_POR_MES - mensalidade,
      minimo: cartelasParaPagarMensalidade(PROMO_PRICE_CENTS, valor, taxa),
    };
  }, [participantes, valor, taxa]);

  const cobre = conta.sobra >= 0;

  return (
    <div className="rounded-2xl p-6 sm:p-8"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
      <div className="grid lg:grid-cols-2 gap-8">
        <div className="space-y-7">
          <Faixa rotulo="Cartelas vendidas na rodada" valor={participantes} min={5} max={100} passo={1}
            set={setParticipantes} formata={(v) => v} sufixo=" cartelas" />
          <Faixa rotulo="Valor da cartela" valor={valor} min={5} max={60} passo={5}
            set={setValor} formata={real} />
          <Faixa rotulo="Sua taxa de administração" valor={taxa} min={0} max={MAX_ADMIN_PCT} passo={1}
            set={setTaxa} formata={(v) => v} sufixo="%" />

          <div className="rounded-xl p-4" style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-sm" style={{ color: '#9fb3a6' }}>Arrecadado na rodada</span>
              <span className="text-sm font-semibold tabular-nums" style={{ color: '#dbe6de' }}>{real(conta.arrecadado)}</span>
            </div>
            <div className="flex items-center justify-between py-1.5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <span className="text-sm" style={{ color: '#9fb3a6' }}>Prêmio dos vencedores ({conta.premioPct}%)</span>
              <span className="text-sm font-semibold tabular-nums" style={{ color: '#dbe6de' }}>{real(conta.premio)}</span>
            </div>
            <div className="flex items-center justify-between py-1.5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <span className="text-sm" style={{ color: '#9fb3a6' }}>Sua taxa de administração ({taxa}%)</span>
              <span className="text-sm font-bold tabular-nums" style={{ color: '#34d375' }}>{real(conta.administracao)}</span>
            </div>
            <div className="flex items-center justify-between py-1.5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <span className="text-sm" style={{ color: '#9fb3a6' }}>
                Mensalidade do sistema <span style={{ color: '#6f8177' }}>(1× por mês)</span>
              </span>
              <span className="text-sm font-semibold tabular-nums" style={{ color: '#dbe6de' }}>− {real(conta.mensalidade)}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-center">
          <div className="rounded-2xl p-6 text-center"
            style={{
              background: cobre
                ? 'linear-gradient(180deg, rgba(0,133,66,0.28), rgba(0,133,66,0.08))'
                : 'linear-gradient(180deg, rgba(255,215,0,0.14), rgba(255,215,0,0.04))',
              border: `1px solid ${cobre ? 'rgba(16,185,87,0.45)' : 'rgba(255,215,0,0.4)'}`,
            }}>
            {cobre ? (
              <>
                <p className="text-[11px] uppercase font-semibold mb-2" style={{ letterSpacing: '0.16em', color: '#9fb3a6' }}>
                  1ª rodada do mês — já paga o sistema e sobra
                </p>
                <p className="font-display mb-4" style={{ fontSize: 'clamp(38px, 6vw, 54px)', lineHeight: 1, color: '#FFD700' }}>
                  {real(conta.sobra)}
                </p>

                {/* A mensalidade é mensal e a rodada é semanal: a partir da
                    segunda rodada do mês a taxa inteira fica com o organizador.
                    É o número que mais convence e estava faltando na tela. */}
                <div className="rounded-xl px-4 py-3 mb-3 text-left"
                  style={{ background: 'rgba(0,0,0,0.28)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <span className="text-sm" style={{ color: '#9fb3a6' }}>Cada rodada seguinte do mês</span>
                    <span className="text-sm font-bold tabular-nums" style={{ color: '#34d375' }}>
                      {real(conta.administracao)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 pt-1.5" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                    <span className="text-sm" style={{ color: '#9fb3a6' }}>
                      No mês, com {RODADAS_POR_MES} rodadas
                    </span>
                    <span className="text-sm font-bold tabular-nums" style={{ color: '#FFD700' }}>
                      {real(conta.noMes)}
                    </span>
                  </div>
                </div>

                <p className="text-sm leading-relaxed" style={{ color: '#dbe6de' }}>
                  A mensalidade é <strong>uma vez por mês</strong> e a rodada é toda
                  semana: só a primeira carrega o desconto.
                </p>
              </>
            ) : (
              <>
                <p className="text-[11px] uppercase font-semibold mb-2" style={{ letterSpacing: '0.16em', color: '#9fb3a6' }}>
                  Faltam cartelas para se pagar
                </p>
                <p className="font-display mb-3" style={{ fontSize: 'clamp(38px, 6vw, 54px)', lineHeight: 1, color: '#FFD700' }}>
                  {conta.minimo}
                </p>
                <p className="text-sm leading-relaxed" style={{ color: '#dbe6de' }}>
                  {taxa === 0
                    ? 'Com taxa zero você não fica com nada da rodada — suba a taxa para o bolão se pagar.'
                    : <>Com cartela de {real(valor)} e taxa de {taxa}%, bastam {conta.minimo} cartelas.
                        {conta.noMes >= 0 && ` Somando as ${RODADAS_POR_MES} rodadas do mês, já sobram ${real(conta.noMes)}.`}</>}
                </p>
              </>
            )}
          </div>

          <p className="text-xs leading-relaxed mt-4" style={{ color: '#6f8177' }}>
            Você define a taxa nas Configurações do painel — o prêmio é o que sobra.
            O dinheiro cai na sua chave PIX e não tiramos percentual. No PIX manual,
            que é o padrão, não há taxa; na baixa automática, a taxa da transação
            é da Woovi.
          </p>

          <button onClick={onCriar}
            className="mt-5 w-full py-3.5 rounded-xl font-semibold inline-flex items-center justify-center gap-2 transition-transform hover:-translate-y-0.5"
            style={{ background: '#FFD700', color: '#0a0f1a', boxShadow: '0 10px 30px -12px rgba(255,215,0,.5)' }}>
            Começar os {TRIAL_DAYS} dias grátis <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

const RECURSOS = [
  {
    icone: Calendar,
    titulo: 'Rodadas prontas, sem digitar jogo',
    texto: 'A tabela oficial entra pronta, com data e horário — inclusive entrando no meio da temporada: as rodadas que faltam já vêm carregadas. Jogo remarcado se corrige sozinho e jogo adiado sai da rodada, sem valer ponto para ninguém.',
  },
  {
    icone: Smartphone,
    titulo: 'Palpite pelo celular',
    texto: 'O participante abre o link, se cadastra com o WhatsApp e preenche a cartela. A rodada fecha 5 minutos antes do primeiro jogo — ninguém palpita com a bola rolando.',
  },
  {
    icone: BarChart3,
    titulo: 'Apuração e ranking na hora',
    texto: 'O placar entra sozinho e a pontuação sai calculada: placar exato vale 3, acertar o vencedor vale 1. Acaba a conferência de segunda-feira.',
  },
  {
    icone: QrCode,
    titulo: 'Cartelas por PIX na sua chave',
    texto: 'O participante vê a chave e o QR Code e paga direto para VOCÊ. O dinheiro não passa pela plataforma, e no PIX manual — o padrão — ninguém desconta taxa nenhuma do que você recebe.',
  },
  {
    icone: MessageCircle,
    titulo: 'Avisos pelo seu WhatsApp',
    texto: 'Conecte seu número por QR Code, como no WhatsApp Web. Lembrete de rodada aberta, resultado e cobrança saem do seu número, não de um desconhecido.',
  },
  {
    icone: Share2,
    titulo: 'Resultado em página pública',
    texto: 'Cada rodada encerrada ganha um endereço com o ranking completo, pronto para colar no grupo. Quem abre não precisa de login.',
  },
];

const AVANCADOS = [
  {
    icone: Store,
    titulo: 'Pontos de venda comissionados',
    texto: `Cadastre bares, lotéricas e parceiros que trazem apostadores. Cada cartela fica vinculada ao estabelecimento e a comissão dele (padrão ${PADRAO_ESTABELECIMENTO_PCT}%, você define) sai calculada, separada do prêmio e da sua taxa.`,
  },
  {
    icone: DollarSign,
    titulo: 'Controle financeiro por rodada',
    texto: 'Arrecadado, pago, pendente, prêmio, sua taxa e comissão de cada ponto de venda — por rodada e no acumulado. Dá para filtrar por estabelecimento e ver quem ainda não pagou.',
  },
  {
    icone: Megaphone,
    titulo: 'Comunicados direto na API do WhatsApp',
    texto: 'Aba própria com modelos prontos e tags que se preenchem sozinhas (a chave PIX, por exemplo). Escolhe o modelo, confere e envia para o grupo ou para quem está devendo.',
  },
  {
    icone: Users,
    titulo: 'Times e jogos seus',
    texto: 'Além da tabela automática do Brasileirão, você cadastra times próprios e monta rodadas à mão. Serve para campeonato amador, da empresa ou entre amigos.',
  },
  {
    icone: Lock,
    titulo: 'Dados separados por bolão',
    texto: 'Cada bolão é isolado no banco por regra de servidor, não por filtro de tela: um organizador não alcança participante, palpite nem financeiro de outro. Nem a lista de nomes.',
  },
  {
    icone: ShieldCheck,
    titulo: 'Baixa automática, se você quiser',
    texto: 'Conectando uma conta Woovi, a cartela é baixada sozinha e o sistema confirma cada pagamento na API antes — ninguém marca cartela paga por fora. É opcional: a taxa da transação é da Woovi, e no PIX manual, que é o padrão, não há taxa.',
  },
];

const ANTES_DEPOIS = [
  ['Planilha que só você entende', 'Painel com rodadas, pagamentos e ranking'],
  ['Cobrar um por um no privado', 'Cobrança automática de quem está devendo'],
  ['Somar ponto na mão toda segunda', 'Apuração no minuto que o jogo acaba'],
  ['Print do ranking no grupo', 'Link do resultado que todos abrem'],
  ['Tirar a mensalidade do bolso', 'A taxa do próprio bolão paga o sistema'],
];

const PERGUNTAS = [
  {
    q: 'A mensalidade sai do meu bolso?',
    a: `Não precisa. Cada rodada separa a sua taxa de administração (padrão ${PADRAO_ADMIN_PCT}%) e a mensalidade é cobrada uma vez por mês. Com 20 cartelas de R$ 15, a taxa de uma rodada já cobre os ${realCent(PROMO_PRICE_CENTS)} — e as outras rodadas do mês ficam inteiras com você.`,
  },
  {
    q: `Preciso de cartão para testar?`,
    a: `Não. São ${TRIAL_DAYS} dias com tudo liberado, sem cartão e sem cadastro de pagamento. O teste cobre uma rodada inteira do Brasileirão, então você arrecada antes de pagar a primeira mensalidade.`,
  },
  {
    q: 'Como recebo o dinheiro das cartelas?',
    a: 'Direto na sua chave PIX. Você cadastra a chave e o participante paga para você. A plataforma não intermedia esse dinheiro e não fica com percentual — a mensalidade é a única cobrança nossa.',
  },
  {
    q: 'Tem taxa sobre cada pagamento recebido?',
    a: 'Nossa, nenhuma. No PIX manual, que é o padrão, o participante paga direto na sua chave e você recebe o valor cheio — a conferência do comprovante é sua. Se quiser que a baixa aconteça sozinha, conecta uma conta Woovi (empresa de pagamentos independente) e a taxa por transação é dela. Compensa quando o bolão cresce e conferir um a um vira trabalho.',
  },
  {
    q: 'Quem define a taxa de administração?',
    a: `Você, nas Configurações do painel. O padrão é ${PADRAO_ADMIN_PCT}% para você e ${PADRAO_ESTABELECIMENTO_PCT}% de comissão para o ponto de venda que trouxe o apostador; o prêmio é o que sobra. Pode zerar a taxa e devolver tudo em prêmio, ou subir se você banca a premiação de outro jeito.`,
  },
  {
    q: 'Quantas pessoas posso ter no bolão?',
    a: 'Sem limite de participantes nem de cartelas por pessoa. A mensalidade é a mesma para um bolão de 8 ou de 80 — e quanto maior o bolão, mais a taxa de administração cobre.',
  },
  {
    q: 'Serve para campeonato amador?',
    a: 'Serve. Você cadastra os times e monta as rodadas à mão. A diferença é que só o Brasileirão Série A tem tabela e placar automáticos; no campeonato próprio, os placares são lançados por você.',
  },
  {
    q: 'E se eu parar de pagar?',
    a: 'O painel e os palpites travam, mas nada é apagado: participantes, palpites e histórico continuam lá. Ao pagar, destrava na hora. Se a rodada seguinte estiver a menos de 2 horas do primeiro jogo, seu bolão entra na próxima — para não misturar com jogo já começado.',
  },
];

export default function Landing({ setView }) {
  const criar = useCallback(() => setView('onboard'), [setView]);
  const [rolou, setRolou] = useState(false);
  const [print, setPrint] = useState(0);

  useEffect(() => {
    const onScroll = () => setRolou(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const cartelasMinimas = cartelasParaPagarMensalidade(PROMO_PRICE_CENTS, 15);

  return (
    <div className="min-h-screen font-body" style={{ background: '#060912' }}>
      <style>{`
        @keyframes bb-pop { from { opacity: 0; transform: scale(.96) } to { opacity: 1; transform: none } }
        @keyframes bb-flutua { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-9px) } }
        .bb-flutua { animation: bb-flutua 6s ease-in-out infinite }
        .bb-card { transition: transform .25s cubic-bezier(.16,1,.3,1), border-color .25s ease }
        .bb-card:hover { transform: translateY(-4px); border-color: rgba(255,215,0,.45) }

        /* Faixa de ajuste. O pegador precisa ser grande o suficiente para o
           dedo (24px) e a trilha alta o suficiente para não exigir precisão —
           slider fino é o que faz o usuário desistir e só clicar. */
        .bb-faixa {
          -webkit-appearance: none; appearance: none;
          height: 10px; border-radius: 999px; outline: none;
          cursor: grab; touch-action: pan-y;
        }
        .bb-faixa:active { cursor: grabbing }
        .bb-faixa::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 24px; height: 24px; border-radius: 50%;
          background: #FFD700; border: 3px solid #060912;
          box-shadow: 0 2px 10px rgba(0,0,0,.5), 0 0 0 1px rgba(255,215,0,.5);
          cursor: grab; transition: transform .12s ease;
        }
        .bb-faixa::-webkit-slider-thumb:hover { transform: scale(1.12) }
        .bb-faixa:active::-webkit-slider-thumb { transform: scale(1.05); cursor: grabbing }
        .bb-faixa::-moz-range-thumb {
          width: 22px; height: 22px; border-radius: 50%;
          background: #FFD700; border: 3px solid #060912;
          box-shadow: 0 2px 10px rgba(0,0,0,.5); cursor: grab;
        }
        .bb-faixa::-moz-range-track { background: transparent }
        .bb-faixa:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 4px rgba(255,215,0,.35) }

        @media (prefers-reduced-motion: reduce) {
          .bb-flutua { animation: none }
          .bb-card:hover { transform: none }
        }
      `}</style>

      {/* ── Topo ───────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 transition-all"
        style={{
          background: rolou ? 'rgba(6,9,18,0.88)' : 'transparent',
          backdropFilter: rolou ? 'blur(10px)' : 'none',
          borderBottom: `1px solid ${rolou ? 'rgba(255,255,255,0.08)' : 'transparent'}`,
        }}>
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between gap-3">
          <Marca compacto claro idSufixo="-topo" />
          <div className="flex items-center gap-1 sm:gap-2">
            <a href="/entrar" className="px-3 py-2 text-sm rounded-lg transition-colors hover:text-[#FFD700] whitespace-nowrap"
              style={{ color: '#cfe6d6' }}>
              Já participo
            </a>
            <button onClick={criar}
              className="px-4 py-2 rounded-xl text-sm font-semibold transition-transform hover:-translate-y-0.5 whitespace-nowrap"
              style={{ background: '#FFD700', color: '#0a0f1a' }}>
              Criar meu bolão
            </button>
          </div>
        </div>
      </header>

      {/* ── Herói ──────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true"
          style={{
            background:
              'radial-gradient(1100px 520px at 18% -10%, rgba(0,133,66,0.5), transparent 60%),' +
              'radial-gradient(760px 420px at 88% 8%, rgba(255,215,0,0.13), transparent 62%),' +
              'repeating-linear-gradient(90deg, rgba(255,255,255,0.016) 0 60px, transparent 60px 120px)',
          }} />

        <div className="relative max-w-6xl mx-auto px-5 pt-12 pb-16 md:pt-20 md:pb-24">
          <div className="grid lg:grid-cols-[1.05fr_.95fr] gap-12 lg:gap-14 items-center">
            <div>
              <Revela>
                <div className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 mb-6"
                  style={{ background: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.28)' }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#FFD700' }} />
                  <span className="text-[11px] font-semibold uppercase" style={{ letterSpacing: '0.16em', color: '#FFD700' }}>
                    Brasileirão 2026 · Série A
                  </span>
                </div>
              </Revela>

              <Revela delay={60}>
                <h1 className="font-display mb-5"
                  style={{ fontSize: 'clamp(36px, 5.6vw, 64px)', lineHeight: 1.03, color: '#f2f6f3' }}>
                  O SEU BOLÃO<br />
                  <span style={{ color: '#FFD700' }}>PAGA O SISTEMA</span><br />
                  E AINDA SOBRA PARA VOCÊ
                </h1>
              </Revela>

              <Revela delay={120}>
                <p className="mb-7 leading-relaxed" style={{ fontSize: '1.0625rem', color: '#b9c9bf', maxWidth: '34rem' }}>
                  Cada rodada separa a sua taxa de administração — você escolhe quanto.
                  Com {cartelasMinimas} cartelas de R$ 15 na taxa padrão, <strong style={{ color: '#e9eef2' }}>uma</strong> rodada
                  já paga o mês inteiro. E o teste de {TRIAL_DAYS} dias cobre uma rodada:
                  você arrecada antes de pagar a primeira vez.
                </p>
              </Revela>

              <Revela delay={180}>
                <div className="flex flex-col sm:flex-row gap-3 mb-6">
                  <button onClick={criar}
                    className="py-3.5 px-7 rounded-xl font-semibold inline-flex items-center justify-center gap-2 transition-transform hover:-translate-y-0.5"
                    style={{ background: '#FFD700', color: '#0a0f1a', boxShadow: '0 10px 30px -12px rgba(255,215,0,.55)' }}>
                    Criar meu bolão <ArrowRight size={18} />
                  </button>
                  <a href="#conta"
                    className="py-3.5 px-7 rounded-xl font-semibold inline-flex items-center justify-center gap-2 transition-colors"
                    style={{ border: '1px solid rgba(255,255,255,0.22)', color: '#e9eef2' }}>
                    Fazer a conta do meu bolão
                  </a>
                </div>
              </Revela>

              <Revela delay={240}>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5 text-sm" style={{ color: '#9fb3a6' }}>
                  {[`${TRIAL_DAYS} dias grátis`, 'sem cartão de crédito', 'cancela quando quiser'].map(t => (
                    <span key={t} className="inline-flex items-center gap-1.5">
                      <Check size={15} style={{ color: '#34d375' }} /> {t}
                    </span>
                  ))}
                </div>
              </Revela>
            </div>

            <Revela delay={200} className="lg:pl-2">
              <div className="bb-flutua"><CartaoResultado /></div>
              <p className="text-xs text-center mt-3" style={{ color: '#5c6b60' }}>
                Exemplo com {EXEMPLO.cartelas} cartelas de {real(EXEMPLO.valor)} — a divisão é a que o painel faz.
              </p>
            </Revela>
          </div>
        </div>
      </section>

      {/* ── Calculadora ────────────────────────────────────────────────────── */}
      <section id="conta" style={{ background: '#0a0f1a', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="max-w-6xl mx-auto px-5 py-16 md:py-20">
          <Revela>
            <h2 className="font-display text-center mb-3" style={{ fontSize: 'clamp(26px, 3.6vw, 40px)', color: '#f2f6f3' }}>
              FAÇA A CONTA DO SEU BOLÃO
            </h2>
            <p className="text-center max-w-2xl mx-auto mb-10" style={{ color: '#9fb3a6' }}>
              Mexa nos números do seu grupo. A conta é a mesma que o painel aplica quando
              a rodada encerra — não é estimativa de propaganda.
            </p>
          </Revela>
          <Revela delay={80}><Calculadora onCriar={criar} /></Revela>
        </div>
      </section>

      {/* ── Como funciona ──────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 py-16 md:py-20">
        <Revela>
          <h2 className="font-display text-center mb-12" style={{ fontSize: 'clamp(26px, 3.6vw, 40px)', color: '#f2f6f3' }}>
            COMEÇA EM TRÊS PASSOS
          </h2>
        </Revela>
        <div className="grid md:grid-cols-3 gap-5">
          {[
            ['01', 'Crie o bolão', 'Nome, valor da cartela e sua chave PIX. Um assistente pergunta só o necessário e as rodadas do Brasileirão já vêm carregadas.'],
            ['02', 'Mande o link no grupo', 'Seu bolão ganha um endereço curto e próprio, fácil de ditar. Quem abre se cadastra com o WhatsApp e já palpita.'],
            ['03', 'Receba e acompanhe', 'As cartelas caem na sua chave PIX, os placares entram sozinhos e o ranking sai pronto. Você confere o financeiro e entrega o prêmio.'],
          ].map(([n, titulo, texto], i) => (
            <Revela key={n} delay={i * 90}>
              <div className="bb-card h-full rounded-2xl p-6"
                style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.09)' }}>
                <p className="font-display mb-4" style={{ color: 'rgba(255,215,0,0.55)', fontSize: '1.5rem' }}>{n}</p>
                <h3 className="font-display text-lg mb-2" style={{ color: '#f2f6f3', letterSpacing: '0.02em' }}>
                  {titulo.toUpperCase()}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: '#9fb3a6' }}>{texto}</p>
              </div>
            </Revela>
          ))}
        </div>
      </section>

      {/* ── Painel por dentro (prints do sistema real) ──────────────────────
          Só renderiza quando existem arquivos em /public/prints. */}
      {PRINTS.length > 0 && (
        <section style={{ background: '#0a0f1a', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="max-w-6xl mx-auto px-5 py-16 md:py-20">
            <Revela>
              <h2 className="font-display text-center mb-3" style={{ fontSize: 'clamp(26px, 3.6vw, 40px)', color: '#f2f6f3' }}>
                O PAINEL POR DENTRO
              </h2>
              <p className="text-center max-w-2xl mx-auto mb-8" style={{ color: '#9fb3a6' }}>
                Telas do sistema em uso, sem maquiagem.
              </p>
            </Revela>

            <Revela delay={60}>
              <div className="flex flex-wrap justify-center gap-2 mb-6">
                {PRINTS.map((p, i) => (
                  <button key={p.arquivo} onClick={() => setPrint(i)}
                    className="px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                    style={{
                      background: print === i ? '#FFD700' : 'rgba(255,255,255,0.06)',
                      color: print === i ? '#0a0f1a' : '#cfe6d6',
                      border: '1px solid rgba(255,255,255,0.09)',
                    }}>
                    {p.rotulo}
                  </button>
                ))}
              </div>

              <div className="rounded-2xl overflow-hidden"
                style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.35)' }}>
                {/* Moldura de janela: dá contexto de "é um sistema", sem simular
                    navegador de verdade (o que confundiria com print falso). */}
                <div className="flex items-center gap-1.5 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  {['#ef6461', '#f9c74f', '#34d375'].map(c => (
                    <span key={c} className="w-2.5 h-2.5 rounded-full" style={{ background: c, opacity: 0.7 }} />
                  ))}
                  <span className="ml-3 text-xs font-mono truncate" style={{ color: '#6f8177' }}>
                    brasilbolao.com.br — {PRINTS[print].rotulo}
                  </span>
                </div>
                <img src={`/prints/${PRINTS[print].arquivo}`} alt={PRINTS[print].alt}
                  className="w-full block" loading="lazy" />
              </div>
              <p className="text-sm text-center mt-4" style={{ color: '#9fb3a6' }}>{PRINTS[print].legenda}</p>
            </Revela>
          </div>
        </section>
      )}

      {/* ── Recursos ───────────────────────────────────────────────────────── */}
      <section style={{ background: PRINTS.length > 0 ? '#060912' : '#0a0f1a', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="max-w-6xl mx-auto px-5 py-16 md:py-20">
          <Revela>
            <h2 className="font-display text-center mb-3" style={{ fontSize: 'clamp(26px, 3.6vw, 40px)', color: '#f2f6f3' }}>
              O QUE JÁ VEM PRONTO
            </h2>
            <p className="text-center max-w-2xl mx-auto mb-12" style={{ color: '#9fb3a6' }}>
              Tudo abaixo funciona hoje. Não é lista de plano futuro.
            </p>
          </Revela>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {RECURSOS.map((recurso, i) => {
              const Icone = recurso.icone;
              return (
                <Revela key={recurso.titulo} delay={(i % 3) * 80}>
                  <div className="bb-card h-full rounded-2xl p-6"
                    style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.09)' }}>
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4"
                      style={{ background: 'rgba(0,133,66,0.22)', border: '1px solid rgba(16,185,87,0.3)' }}>
                      <Icone size={20} style={{ color: '#6ee7a5' }} />
                    </div>
                    <h3 className="font-semibold mb-2" style={{ color: '#f2f6f3' }}>{recurso.titulo}</h3>
                    <p className="text-sm leading-relaxed" style={{ color: '#9fb3a6' }}>{recurso.texto}</p>
                  </div>
                </Revela>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Recursos avançados ─────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 py-16 md:py-20">
        <Revela>
          <h2 className="font-display text-center mb-3" style={{ fontSize: 'clamp(26px, 3.6vw, 40px)', color: '#f2f6f3' }}>
            E VAI MAIS LONGE
          </h2>
          <p className="text-center max-w-2xl mx-auto mb-12" style={{ color: '#9fb3a6' }}>
            O que separa um bolão de amigos de uma operação organizada.
          </p>
        </Revela>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {AVANCADOS.map((recurso, i) => {
            const Icone = recurso.icone;
            return (
              <Revela key={recurso.titulo} delay={(i % 3) * 80}>
                <div className="bb-card h-full rounded-2xl p-6"
                  style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,215,0,0.16)' }}>
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4"
                    style={{ background: 'rgba(255,215,0,0.12)', border: '1px solid rgba(255,215,0,0.3)' }}>
                    <Icone size={20} style={{ color: '#FFD700' }} />
                  </div>
                  <h3 className="font-semibold mb-2" style={{ color: '#f2f6f3' }}>{recurso.titulo}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: '#9fb3a6' }}>{recurso.texto}</p>
                </div>
              </Revela>
            );
          })}
        </div>
      </section>

      {/* ── Antes e depois ─────────────────────────────────────────────────── */}
      <section style={{ background: '#0a0f1a', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="max-w-5xl mx-auto px-5 py-16 md:py-20">
          <Revela>
            <h2 className="font-display text-center mb-3" style={{ fontSize: 'clamp(26px, 3.6vw, 40px)', color: '#f2f6f3' }}>
              O TRABALHO SAI DAS SUAS COSTAS
            </h2>
            <p className="text-center max-w-2xl mx-auto mb-12" style={{ color: '#9fb3a6' }}>
              Quem já organizou bolão conhece a parte chata. Ela nunca foi o bolão —
              é a planilha, a cobrança e a conferência.
            </p>
          </Revela>

          <div className="max-w-3xl mx-auto">
            {ANTES_DEPOIS.map(([antes, depois], i) => (
              <Revela key={antes} delay={i * 70}>
                <div className="grid sm:grid-cols-2 gap-2 sm:gap-8 py-4"
                  style={{ borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.07)' }}>
                  <div className="flex items-start gap-2.5">
                    <X size={17} style={{ color: '#ef6461', flexShrink: 0, marginTop: 2 }} />
                    <span className="text-sm line-through" style={{ color: '#6f8177', textDecorationColor: '#44544b' }}>{antes}</span>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <Check size={17} style={{ color: '#34d375', flexShrink: 0, marginTop: 2 }} />
                    <span className="text-sm font-medium" style={{ color: '#e9eef2' }}>{depois}</span>
                  </div>
                </div>
              </Revela>
            ))}
          </div>
        </div>
      </section>

      {/* ── Preço ──────────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 py-16 md:py-20">
        <Revela>
          <div className="max-w-lg mx-auto">
            <div className="relative rounded-2xl p-8 text-center overflow-hidden"
              style={{
                background: 'linear-gradient(180deg, rgba(255,215,0,0.07), rgba(255,255,255,0.03))',
                border: '2px solid rgba(255,215,0,0.55)',
              }}>
              <div className="absolute top-0 right-0 text-[11px] font-bold px-4 py-1.5 rounded-bl-xl"
                style={{ background: '#FFD700', color: '#0a0f1a', letterSpacing: '0.1em' }}>
                LANÇAMENTO
              </div>

              <p className="text-xs uppercase font-semibold mb-5" style={{ letterSpacing: '0.18em', color: '#9fb3a6' }}>
                Plano único
              </p>

              <p className="line-through text-lg mb-1" style={{ color: '#6f8177' }}>{realCent(PRICE_CENTS)}</p>
              <div className="flex items-end justify-center gap-1.5 mb-2">
                <span className="font-display" style={{ fontSize: 'clamp(44px, 7vw, 64px)', lineHeight: 1, color: '#FFD700' }}>
                  {realCent(PROMO_PRICE_CENTS)}
                </span>
                <span className="mb-2" style={{ color: '#9fb3a6' }}>/mês</span>
              </div>
              <p className="text-sm mb-7" style={{ color: '#9fb3a6' }}>
                Uma cobrança por mês. Equivale à taxa de administração de
                {' '}<strong style={{ color: '#dbe6de' }}>{cartelasMinimas} cartelas de R$ 15</strong> em
                {' '}<strong style={{ color: '#dbe6de' }}>uma</strong> rodada — as outras do mês ficam com você.
              </p>

              <ul className="text-left space-y-2.5 mb-8">
                {[
                  `${TRIAL_DAYS} dias grátis, sem cartão`,
                  'Participantes e cartelas sem limite',
                  'O dinheiro das cartelas cai na sua chave PIX',
                  'Avisos pelo seu próprio WhatsApp',
                  'Pagamento por PIX, mês a mês',
                  'Cancela quando quiser — nada é apagado',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2.5">
                    <Check size={17} style={{ color: '#34d375', flexShrink: 0, marginTop: 2 }} />
                    <span className="text-sm" style={{ color: '#dbe6de' }}>{item}</span>
                  </li>
                ))}
              </ul>

              <button onClick={criar}
                className="w-full py-3.5 rounded-xl font-semibold inline-flex items-center justify-center gap-2 transition-transform hover:-translate-y-0.5"
                style={{ background: '#FFD700', color: '#0a0f1a', boxShadow: '0 10px 30px -12px rgba(255,215,0,.5)' }}>
                Começar o teste grátis <ArrowRight size={18} />
              </button>
              <p className="text-xs mt-3" style={{ color: '#6f8177' }}>
                Para criar, só nome, WhatsApp e e-mail.
              </p>
            </div>

            <div className="mt-5 flex items-start gap-3 rounded-xl p-4"
              style={{ border: '1px solid rgba(255,255,255,0.09)' }}>
              <Wallet size={18} style={{ color: '#9fb3a6', flexShrink: 0, marginTop: 2 }} />
              <p className="text-sm leading-relaxed" style={{ color: '#9fb3a6' }}>
                A mensalidade é a nossa única cobrança — não tiramos percentual das
                cartelas. O valor delas é entre você e os participantes, na sua chave
                PIX. A baixa automática é opcional e a taxa de transação, quando você
                a liga, é da Woovi.
              </p>
            </div>
          </div>
        </Revela>
      </section>

      {/* ── Perguntas ──────────────────────────────────────────────────────── */}
      <section style={{ background: '#0a0f1a', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="max-w-3xl mx-auto px-5 py-16 md:py-20">
          <Revela>
            <h2 className="font-display text-center mb-10" style={{ fontSize: 'clamp(26px, 3.6vw, 40px)', color: '#f2f6f3' }}>
              PERGUNTAS DIRETAS
            </h2>
          </Revela>
          <div className="space-y-3">
            {PERGUNTAS.map(({ q, a }, i) => (
              <Revela key={q} delay={i * 50}>
                <details className="group rounded-xl p-5"
                  style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.09)' }}>
                  <summary className="font-semibold cursor-pointer list-none flex items-start justify-between gap-4"
                    style={{ color: '#f2f6f3' }}>
                    <span>{q}</span>
                    <ArrowRight size={17} className="flex-shrink-0 mt-0.5 transition-transform group-open:rotate-90"
                      style={{ color: '#FFD700' }} />
                  </summary>
                  <p className="text-sm leading-relaxed mt-3" style={{ color: '#9fb3a6' }}>{a}</p>
                </details>
              </Revela>
            ))}
          </div>
        </div>
      </section>

      {/* ── Fechamento ─────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 py-16 md:py-20">
        <Revela>
          <div className="relative rounded-3xl px-6 py-12 sm:px-12 text-center overflow-hidden"
            style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
            <div className="absolute inset-0 pointer-events-none" aria-hidden="true"
              style={{
                background:
                  'radial-gradient(600px 300px at 50% 0%, rgba(0,133,66,0.4), transparent 65%),' +
                  'radial-gradient(400px 240px at 85% 100%, rgba(255,215,0,0.1), transparent 60%)',
              }} />
            <div className="relative">
              {/* Sem contadores aqui: o número de rodadas do campeonato inteiro não
                  vale para quem entra com a temporada em andamento, e quantas
                  cartelas pagam o mês depende do valor e da taxa que o organizador
                  escolher — a calculadora já responde isso com os números dele. */}
              <h2 className="font-display mb-3" style={{ fontSize: 'clamp(26px, 3.6vw, 38px)', color: '#f2f6f3' }}>
                COMECE PELA PRÓXIMA RODADA
              </h2>
              <p className="max-w-xl mx-auto mb-8" style={{ color: '#b9c9bf' }}>
                O Brasileirão está rolando: as rodadas que ainda faltam já entram
                carregadas no seu bolão. Crie hoje, mande o link no grupo e receba as
                cartelas já nesta rodada — a primeira mensalidade só vem depois dos
                {' '}{TRIAL_DAYS} dias.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button onClick={criar}
                  className="py-3.5 px-7 rounded-xl font-semibold inline-flex items-center justify-center gap-2 transition-transform hover:-translate-y-0.5"
                  style={{ background: '#FFD700', color: '#0a0f1a', boxShadow: '0 10px 30px -12px rgba(255,215,0,.5)' }}>
                  Criar meu bolão <ArrowRight size={18} />
                </button>
                <a href={linkWhatsapp} target="_blank" rel="noopener noreferrer"
                  className="py-3.5 px-7 rounded-xl font-semibold inline-flex items-center justify-center gap-2 transition-colors"
                  style={{ border: '1px solid rgba(255,255,255,0.22)', color: '#e9eef2' }}>
                  <MessageCircle size={18} /> Falar no WhatsApp
                </a>
              </div>
            </div>
          </div>
        </Revela>
      </section>

      {/* ── Rodapé ─────────────────────────────────────────────────────────── */}
      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="max-w-6xl mx-auto px-5 py-10">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-5">
            <Marca compacto claro idSufixo="-rodape" />
            <div className="flex items-center gap-5 text-sm">
              <a href="/entrar" className="transition-colors hover:text-[#FFD700]" style={{ color: '#9fb3a6' }}>Já participo</a>
              <a href={linkWhatsapp} target="_blank" rel="noopener noreferrer"
                className="transition-colors hover:text-[#FFD700]" style={{ color: '#9fb3a6' }}>Suporte</a>
            </div>
          </div>
          <p className="text-xs mt-7 text-center sm:text-left leading-relaxed" style={{ color: '#5c6b60' }}>
            Lion Tech Soluções em TI Ltda · CNPJ 44.124.574/0001-47 · Mineiros-GO ·
            liontechti.com.br · WhatsApp (64) 9 9955-5364
          </p>
        </div>
      </footer>
    </div>
  );
}
