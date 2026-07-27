# Plano de transformação em SaaS — Bolão Brasileirão

Documento de planejamento (sem código ainda). Objetivo: transformar o bolão
(hoje mono-cliente) em um produto vendável por mensalidade, onde cada organizador
tem o próprio bolão isolado.

---

## 1. Modelo de negócio

- **Cliente:** organizador de bolão (dono de bar, empresa, grupo de amigos, associação).
- **Valor entregue:** ele monta e gerencia o bolão dele sem planilha, com cobrança PIX, ranking automático e avisos por WhatsApp.
- **Monetização:** mensalidade por organizador (tenant), com planos por limite de participantes/bolões.
- **Exemplo de planos (a definir):**
  - Grátis: 1 bolão, até 15 participantes (isca de aquisição).
  - Pro: R$ 29–49/mês, bolões ilimitados, até 100 participantes, WhatsApp incluso.
  - Premium: R$ 79–99/mês, participantes ilimitados, marca própria, relatórios.
- A taxa de administração do bolão (que o organizador já cobra dos participantes) continua com ele; a Lion Tech ganha na mensalidade.

## 2. Arquitetura multi-tenant (o coração da mudança)

Hoje as coleções (`users`, `rounds`, `predictions`, `settings`...) são globais — um único bolão. No SaaS, cada organizador é um **tenant** e os dados precisam ser isolados.

**Abordagem recomendada:** campo `tenantId` em todos os documentos + regras que garantem isolamento. (Alternativa: subcoleções sob `/tenants/{id}/...` — isolamento mais forte, porém migração maior. Fica como opção.)

Mudanças:
- Nova coleção `tenants/{tenantId}`: dados do organizador, plano, status de pagamento, branding, config PIX/WhatsApp própria.
- Nova coleção `memberships` (ou campo no user): liga usuário ↔ tenant ↔ papel (dono/participante). Um usuário pode participar de vários bolões.
- `tenantId` em `rounds`, `predictions`, `settings`, `establishments`, `communications`, etc.
- **Regras do Firestore:** toda leitura/escrita valida que o usuário pertence ao tenant e que o `tenantId` do documento bate. O "admin" deixa de ser global e passa a ser **dono do tenant**.
- **Super-admin (Kirk):** visão de todos os tenants (faturamento, uso, inadimplência).

## 3. Cobrança (mensalidade)

- **Gateway recomendado (Brasil):** Asaas — assinaturas recorrentes com PIX/boleto/cartão, webhook de status, taxas baixas em PIX. (Alternativa: Stripe, melhor para cartão internacional; Iugu.)
- Fluxo: organizador escolhe plano → cria assinatura no gateway → webhook atualiza `tenants/{id}.plano` e `status`. Inadimplência → suspende recursos (ou modo somente-leitura) após carência.
- Limites por plano aplicados nas regras e na UI (nº de participantes/bolões).

## 4. Onboarding self-service

- Cadastro do organizador → cria o tenant → assistente de configuração (nome do bolão, chave PIX, valor da cartela, WhatsApp/grupo) → link de convite para participantes.
- Participante entra pelo link, cai já no tenant certo.

## 5. Painel do dono do SaaS (Kirk)

- Lista de tenants, plano, status de pagamento, nº de participantes, última atividade.
- Métricas: MRR (receita recorrente), churn, tenants ativos.
- Ações: suspender/reativar, conceder cortesia, suporte.

## 6. Fases de implementação (roadmap)

- **Fase 0 — Fundação/infra:** habilitar **Blaze** (billing) no Firebase (obrigatório para escalar, Storage, backups em nuvem e mais funções). Otimizar as queries do Firestore — hoje o app usa `onSnapshot` em coleções inteiras, o que fica **caro e lento** com muitos tenants; passar a filtrar por `tenantId` e paginar.
- **Fase 1 — Refatorar `App.jsx`:** quebrar o monólito (7000+ linhas) em módulos, criando uma camada de dados e um "contexto de tenant". Pré-requisito prático para o multi-tenant.
- **Fase 2 — Multi-tenancy:** `tenantId` em tudo + regras de isolamento + script que migra os dados atuais para um "tenant padrão" (o bolão do Kirk).
- **Fase 3 — Onboarding + config por tenant:** cadastro de organizador, assistente, convites.
- **Fase 4 — Cobrança + limites + super-admin:** Asaas, planos, suspensão, painel do dono.
- **Fase 5 — Marketing:** landing de vendas, materiais, polimento.

## 7. Custos estimados (mensais, começando pequeno)

- **Firebase Blaze (pago por uso):** com poucos tenants, ~R$ 0–150/mês. O maior vetor de custo é **leitura do Firestore** — por isso otimizar as queries (Fase 0) é crítico.
- **Vercel:** grátis (Hobby) no início; Pro ~US$ 20 (~R$ 110) quando escalar.
- **Gateway (Asaas):** sem mensalidade fixa; ~1% em PIX ou taxa por boleto/cartão sobre cada mensalidade recebida (sai do faturamento, não é custo fixo).
- **Domínio:** ~R$ 40/ano.
- **API de futebol:** free limitado; pago ~US$ 15–25/mês se precisar de mais chamadas.
- **WhatsApp (EvolutionAPI):** já roda na VPS Hostinger do Kirk (custo já existente).
- **Resumo:** custo fixo inicial ~R$ 150–350/mês. O gargalo de custo real é o Firestore conforme cresce — daí a importância da Fase 0.

## 8. Migração dos dados atuais

- Os dados de hoje viram o **tenant padrão** (bolão do Kirk).
- Script adiciona `tenantId` a todos os documentos existentes e cria o doc `tenants/{padrao}` + `memberships` dos usuários atuais.
- Reversível/testável em homologação antes de valer para todos.

## 9. Riscos e decisões em aberto

- **Blaze é pré-requisito** (billing) — decisão de negócio (cartão/gasto variável).
- **Refatorar o `App.jsx`** é trabalhoso e sem mudança visível; mas sem isso o multi-tenant fica frágil.
- **Escolha do gateway** (Asaas x Stripe x Iugu) — impacta taxas e experiência.
- **Modelo de planos e preços** — precisa validar com o mercado (quanto um organizador paga).
- **Suporte e SLA** — SaaS gera demanda de suporte; definir canal (WhatsApp).

## 10. Recomendação de sequência

1. Fase 0 (Blaze + otimizar queries) — destrava tudo e reduz custo/risco.
2. Fase 1 (refatorar) — base limpa.
3. Fases 2–4 (multi-tenant → onboarding → cobrança) — o produto em si.
4. Fase 5 (marketing) — vender.

MVP vendável = Fases 0 a 4. Fase 5 pode começar em paralelo à 4.
