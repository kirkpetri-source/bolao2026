# Bolão Brasileirão 2026 — Documentação Completa do Sistema

> Versão: Ambiente DEV · Atualizado: 2026-05-16

---

## Visão Geral

Sistema web completo para gestão de bolão do Campeonato Brasileiro. Permite que participantes registrem palpites por rodada, acompanhem o ranking e realizem pagamentos via PIX. O administrador gerencia rodadas, times, participantes, pagamentos e comunicados via WhatsApp — com grande parte da operação automatizada por funções serverless.

---

## Stack Tecnológica

| Camada | Tecnologia |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS |
| Banco de Dados | Firebase Firestore (tempo real) |
| Autenticação | Firebase Auth (identificação) + bcrypt (senhas) |
| Funções de Backend | Vercel Serverless Functions (`/api`) |
| WhatsApp | EvolutionAPI (proxy serverless) |
| Pagamento automático | Woovi / OpenPix |
| Pagamento manual | PIX manual com chave configurável |
| Scores externos | TheSportsDB (gratuito) + API-Football (opcional, ao vivo) |

---

## Coleções do Firestore

| Coleção | Conteúdo |
|---|---|
| `users` | Participantes e administradores |
| `rounds` | Rodadas com jogos, status, datas de fechamento |
| `predictions` | Palpites de cada participante por rodada/cartela |
| `teams` | Times cadastrados na competição |
| `settings` | Configurações globais do sistema (única linha) |
| `establishments` | Estabelecimentos parceiros |
| `communications` | Histórico de comunicados enviados |
| `team_import_requests` | Solicitações de importação de times da API |
| `audit_logs` | Auditoria de ações críticas (pagamentos, importações) |
| `_locks` | Lock distribuído para evitar dupla inicialização |

---

## Painel do Administrador

O admin acessa o mesmo sistema, mas vê um layout completamente diferente após o login — uma sidebar de navegação com 8 seções.

### 1. Dashboard

Visão financeira consolidada por rodada (apenas rodadas fechadas e finalizadas).

**Métricas exibidas:**
- **Arrecadado** — total de cartelas pagas × valor da aposta
- **Premiação (85%)** — parcela que vai ao(s) vencedor(es)
- **Taxa Admin (10%)** — comissão do administrador
- **Comissão Estabelecimentos (5%)** — dividida proporcionalmente por palpite vinculado a cada estabelecimento
- **Ranking parcial** — pontuação em tempo real (para rodadas fechadas) ou ranking final (para rodadas finalizadas)
- **Lista de vencedores** com valor a receber por vencedor (em caso de empate, o prêmio é dividido igualmente)

> O Dashboard exibe "Parcial" para rodadas fechadas (jogos em andamento) e "Final" para rodadas finalizadas.

---

### 2. Rodadas

Gerenciamento completo do ciclo de vida das rodadas.

**Status possíveis de uma rodada:**

| Status | Significado |
|---|---|
| `upcoming` | Ainda não aberta para palpites |
| `open` | Aberta — participantes podem fazer palpites |
| `closed` | Fechada — palpites encerrados, jogos em andamento |
| `finished` | Finalizada — resultados calculados, ranking definitivo |

**Ações manuais disponíveis:**
- Criar rodada manualmente (nome, jogos, data de fechamento)
- Editar uma rodada existente (somente status `upcoming` ou `open`)
- Alterar o status de qualquer rodada
- Excluir rodada (somente se não houver palpites vinculados)
- **Sincronizar da API** — busca os jogos atualizados no TheSportsDB para todas as 38 rodadas e atualiza o Firestore

**Agrupamento visual:**
- Abertas — cards completos com todos os jogos
- Fechadas — cards completos
- Finalizadas — lista compacta
- A vencer — lista compacta

---

### 3. Times

Gerenciamento do elenco de times cadastrados.

**Ações disponíveis:**
- Adicionar time manualmente (nome + URL de escudo)
- Editar nome e escudo (bloqueado se o time está em rodada ativa/fechada/finalizada)
- Excluir time (bloqueado se vinculado a rodada ativa/fechada/finalizada)
- **Limpar todos os times** — remove todos os registros
- **Restaurar times Série A 2026** — recarrega os 20 times oficiais com logos
- **Importar da API** — busca times no TheSportsDB e cria solicitações de importação pendentes de aprovação
- Aprovar ou rejeitar cada solicitação de importação individualmente

> Times vinculados a rodadas ativas/fechadas/finalizadas são protegidos contra edição de nome e exclusão para preservar integridade dos palpites.

---

### 4. Estabelecimentos

Gerencia parceiros (bares, clubes, etc.) que podem ter participantes vinculados.

**Campos:** nome, descrição, contato.

Quando um participante é associado a um estabelecimento, 5% do valor da cartela desse participante é atribuído como comissão do estabelecimento no Dashboard e no relatório financeiro.

---

### 5. Participantes

Visão completa de todos os usuários e seus palpites por rodada.

**Filtros disponíveis:**
- Por rodada
- Por status de pagamento (todos / pagos / pendentes)
- Por estabelecimento

**Ações por participante:**
- Ver detalhes dos palpites de cada cartela
- Marcar cartela como **paga** ou **não paga** (alteração manual do admin)
- Enviar cobrança via WhatsApp para cartelas pendentes
- Editar dados do usuário
- Excluir usuário

> Toda alteração de status de pagamento gera log na coleção `audit_logs`.

---

### 6. Financeiro

Controle financeiro detalhado por rodada.

**Filtros:**
- Por rodada (somente rodadas não `upcoming`)
- Por estabelecimento

**Resumo financeiro exibido:**
- Total esperado (cartelas × valor)
- Total recebido (somente pagas)
- Total pendente
- Percentual de adimplência
- Quantidade de cartelas pagas vs. pendentes

**Ações:**
- **Gerar PDF financeiro** — exporta relatório detalhado com todas as cartelas de um estabelecimento em uma rodada específica (disponível somente com rodada + estabelecimento selecionados)
- Marcar pagamentos individualmente diretamente nessa tela
- Enviar cobrança via WhatsApp para cada cartela pendente

---

### 7. Comunicados

Envio de mensagens em massa via WhatsApp (EvolutionAPI) para participantes.

**Sub-abas:**

**Envio:**
- Selecionar rodada de referência
- Filtrar destinatários: todos / apenas pagos / apenas pendentes
- Selecionar destinatários individualmente ou selecionar todos
- Escolher um template pré-pronto ou escrever mensagem livre
- Tags dinâmicas disponíveis: `{NOME}`, `{RODADA}`, `{LINK}`, `{LIMITE}`, `{DIVULGACAO}`, `{RANKING_URL}`, `{BRAND}`, `{PIX}`, `{DESTINATARIO}`
- Pré-visualização da mensagem antes do envio
- Envio com confirmação (mostra contagem de destinatários)

**Templates pré-prontos:**
| Chave | Descrição |
|---|---|
| `open-round` | Aviso de rodada aberta para palpites |
| `charge-pending` | Cobrança de cartelas pendentes |
| `round-closed` | Aviso de encerramento de rodada |
| `final-result` | Divulgação do resultado final |

**Histórico:**
- Lista de todos os comunicados enviados com data/hora, autor, destinatários e conteúdo

---

### 8. Configurações

Organizado em sub-abas:

#### WhatsApp / EvolutionAPI
- **Link** da instância EvolutionAPI
- **Nome da instância**
- **Token** de autenticação
- Número do WhatsApp do administrador (para notificações automáticas)
- JID do grupo (para envio de resultados ao grupo)
- Template de mensagem de confirmação de palpite
- Template de mensagem de cobrança

#### Manutenção
- Ativar/desativar modo de manutenção (bloqueia acesso de participantes)
- Mensagem exibida durante a manutenção
- Data/hora estimada de retorno
- IPs que podem acessar mesmo durante a manutenção
- Agendamento automático de início e fim da manutenção

#### Regras do Bolão
Editor de texto com suporte a Markdown básico (negrito, itálico, listas) para:
- Texto completo das regras
- Critérios de pontuação
- Regras de desempate

As regras são exibidas para os participantes em um modal acessível na aba "Regras".

#### Valor de Aposta
- Valor por cartela (R$)
- Valor mínimo e máximo permitido
- Configuração de bônus (percentual)
- Taxa do administrador (%)
- Taxa de estabelecimentos (%)

#### Pagamento (PIX Manual)
- Chave PIX do organizador (e-mail, CPF, CNPJ, telefone ou chave aleatória EVP)
- Nome do recebedor (exibido ao participante para confirmação)
- Validação do formato da chave PIX em tempo real

#### Integrações
- **Woovi / OpenPix** — App ID e Webhook Secret para PIX automático com QR Code
- **Football API** — Chave da API-Football para scores ao vivo (opcional)

#### Testes A/B
- Ativar experimentos de interface (novo dashboard, fluxo de pagamento V2) com percentual de usuários expostos

#### Histórico de Alterações
Log automático de todas as alterações salvas nas configurações (autor, campos alterados, data/hora).

---

## Painel do Participante (Usuário Comum)

### Autenticação
Login com número de WhatsApp (como usuário) e senha. Sessão com timeout de 10 minutos de inatividade — renovada automaticamente enquanto o usuário interage com a página.

### Abas do Usuário

#### Palpites
- Lista todas as rodadas abertas para apostas
- Para cada rodada: selecionar o placar de cada jogo (máximo e mínimo definidos pelo admin)
- Ao confirmar, o sistema gera uma **Cartela** com código único (`CART-XXXX-XXXX`)
- Cada usuário pode criar múltiplas cartelas por rodada
- Após confirmar, o modal de pagamento é aberto automaticamente

#### Ranking
- Classificação por rodada (fechadas ou finalizadas)
- Exibe pontuação de cada participante
- Destaca o(s) vencedor(es) com o valor do prêmio (85% do arrecadado)
- Rodadas fechadas mostram ranking parcial; finalizadas mostram ranking definitivo

#### Finalizadas
- Lista de rodadas finalizadas com o ranking definitivo de cada uma
- Destaque para o campeão de cada rodada

#### Minhas Rodadas
- Histórico completo de todas as cartelas do usuário
- Palpites registrados, pontuação obtida e status de pagamento

---

## Fluxos de Pagamento

### Fluxo PIX Manual (padrão)

```
Usuário confirma palpites
        ↓
Modal de pagamento exibe a chave PIX e nome do recebedor
        ↓
Usuário copia a chave e realiza o pagamento no app do banco
        ↓
Usuário envia o comprovante via WhatsApp para o administrador
        ↓
Administrador confere o comprovante
        ↓
Admin marca a cartela como "paga" no painel de Participantes ou Financeiro
        ↓
Log registrado na coleção audit_logs
```

### Fluxo Woovi / OpenPix (automático)

```
Usuário confirma palpites
        ↓
Sistema chama /api/payments/woovi-charge (cria cobrança na Woovi)
        ↓
Modal exibe QR Code PIX + código copia-e-cola + timer de 30 minutos
        ↓
Usuário paga pelo app do banco
        ↓
Woovi envia webhook para /api/payments/woovi-webhook
        ↓
Sistema verifica o pagamento diretamente na API da Woovi (double-check)
        ↓
Cartela marcada como paga no Firestore
        ↓
Notificação automática via WhatsApp enviada ao participante
```

> O webhook da Woovi deve ser configurado apontando para:
> `https://seu-dominio.vercel.app/api/payments/woovi-webhook`

---

## Automações — Cron Jobs

Todas as automações são funções serverless executadas automaticamente pela Vercel. Exigem a variável de ambiente `CRON_SECRET` configurada no painel da Vercel.

### `bolao-engine` — a cada 5 minutos (`*/5 * * * *`)

O motor central do bolão. Em cada execução, percorre todas as rodadas e executa 3 verificações:

**1. Auto-abertura de rodadas**
- Condição: rodada com status `upcoming` cujo 1º jogo ocorre em até **5 dias**
- Ação: muda o status para `open`
- Ação adicional: envia notificação via WhatsApp para **todos os participantes** (uma única vez por rodada)
- Mensagem: "A rodada X foi aberta! Vocês têm até Y dias para apostas."

**2. Alerta de 1 hora**
- Condição: rodada `open` com menos de 1 hora para o fechamento (5 min antes do 1º jogo)
- Ação: envia alerta via WhatsApp **apenas para participantes sem palpite** na rodada (uma única vez)
- Mensagem: "A rodada X fecha em 1 hora! Registre seus palpites."

**3. Auto-fechamento**
- Condição: rodada `open` com data/hora de fechamento já passada (5 min antes do 1º jogo)
- Ação: muda o status para `closed`
- Ação adicional: envia notificação ao **admin** confirmando o fechamento

---

### `sync-scores` — a cada 5 minutos (`*/5 * * * *`)

Atualiza os placares das rodadas fechadas e finaliza o bolão automaticamente.

**Fluxo:**
1. Busca todas as rodadas com status `closed` que ainda têm jogos não finalizados
2. Tenta buscar placares ao vivo na **API-Football** (se `APIFOOTBALL_KEY` configurado)
3. Busca placares do **TheSportsDB** como fonte secundária
4. Atualiza os placares dos jogos no Firestore
5. Quando **todos os jogos de uma rodada estão finalizados:**
   - Calcula a pontuação de cada participante (10 pts por placar exato, 3 pts por resultado correto)
   - Monta o ranking final
   - Marca a rodada como `finished`
   - Gera um PDF com o ranking (usando jsPDF)
   - Envia o PDF ao **grupo do WhatsApp** configurado (ou ao admin, se grupo não configurado)
   - Registra `resultSentToGroup: true` para evitar reenvio

**Sistema de pontuação:**
| Acerto | Pontos |
|---|---|
| Placar exato (ex: 2×1 → 2×1) | 10 pontos |
| Resultado correto (vitória/empate) | 3 pontos |
| Errou o resultado | 0 pontos |

---

### `sync-rounds` — diariamente às 8h (`0 8 * * *`)

Sincroniza os jogos de todas as 38 rodadas com o TheSportsDB.

**Fluxo:**
1. Para cada rodada de 1 a 38 (ou a rodada específica se `?round=N` for passado):
   - Busca os fixtures no TheSportsDB (liga `4351`, temporada `2026`)
   - Resolve os IDs dos times no Firestore por nome normalizado
   - Calcula o `closeAt` (5 min antes do 1º jogo)
   - Aplica `smartStatus`: se o 1º jogo já passou → `closed`; se em até 5 dias → `open`; senão → `upcoming`
   - Atualiza rodada existente (se ainda não finalizada) ou cria nova

> Pode ser acionado manualmente pelo admin no painel de Rodadas clicando em "Sincronizar da API".

---

### `sync-teams` — toda segunda às 6h (`0 6 * * 1`)

Sincroniza os 20 times da Série A com o TheSportsDB.

**Fluxo:**
1. Extrai times únicos das rodadas 1 a 4 (cobrem todos os 20 times)
2. Compara com times já existentes no Firestore (por `apiTeamId` ou nome normalizado)
3. Atualiza logo e `apiTeamId` de times existentes quando necessário
4. Cria times novos que não existem ainda

---

## Variáveis de Ambiente (Vercel)

| Variável | Obrigatoriedade | Descrição |
|---|---|---|
| `CRON_SECRET` | **Obrigatório** | Segredo para autenticar cron jobs e endpoints protegidos |
| `VITE_FIREBASE_API_KEY` | Obrigatório | Chave da API do Firebase |
| `VITE_FIREBASE_AUTH_DOMAIN` | Obrigatório | Domínio de autenticação Firebase |
| `VITE_FIREBASE_PROJECT_ID` | Obrigatório | ID do projeto Firebase |
| `VITE_FIREBASE_STORAGE_BUCKET` | Obrigatório | Bucket de storage Firebase |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Obrigatório | Sender ID Firebase |
| `VITE_FIREBASE_APP_ID` | Obrigatório | App ID Firebase |
| `WOOVI_APP_ID` | Opcional | App ID da Woovi (alternativa às configurações do painel) |
| `EVOLUTION_LINK` | Opcional | URL da instância EvolutionAPI (alternativa ao painel) |
| `EVOLUTION_INSTANCE` | Opcional | Nome da instância EvolutionAPI |
| `EVOLUTION_TOKEN` | Opcional | Token de autenticação EvolutionAPI |
| `EVOLUTION_VERIFY_TLS` | Opcional | `true` para validar certificado TLS da EvolutionAPI (padrão: `false`) |
| `EVOLUTION_ALLOW_HTTP_UPSTREAM` | Opcional | `true` para permitir URLs HTTP na EvolutionAPI (padrão: `false`) |
| `APIFOOTBALL_KEY` | Opcional | Chave da API-Football para scores ao vivo |
| `BRASILEIRAO_API_URL` | Opcional | URL externa alternativa para listagem de times |

> As configurações de EvolutionAPI e Woovi podem ser definidas pelo painel de Configurações em vez de variáveis de ambiente. O painel tem prioridade sobre as variáveis.

---

## Segurança

| Mecanismo | Descrição |
|---|---|
| Senhas | Armazenadas com `bcrypt` (fator 10) — nunca em texto puro |
| Sessão | Assinada com SHA-256 (`userId + issuedAt + SESSION_SECRET`) armazenada em `localStorage` |
| Timeout de sessão | 10 minutos de inatividade; renovado automaticamente por mousemove, scroll, teclas |
| Controle de acesso | `requireAdmin()` em todas as operações sensíveis do frontend |
| Endpoints de cron | Protegidos por `Authorization: Bearer {CRON_SECRET}` |
| `simulate-pix` | Protegido por `CRON_SECRET` (não é acessível pelo frontend) |
| `sendDocument` | Protegido por `CRON_SECRET` |
| Firestore | Senhas removidas da memória do cliente antes de popular o estado React |
| Headers HTTP | CSP, X-Frame-Options (DENY), HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy |
| Webhook Woovi | Double-check: verifica o pagamento diretamente na API da Woovi antes de marcar como pago |

---

## Arquitectura das Funções de Backend (`/api`)

```
api/
├── _shared/
│   └── firebase.js          # Inicialização Firebase, formatPhone, sendWhatsApp, sendWhatsAppDocument
├── brasileirao/
│   └── teams.js             # Lista times da API externa ou fallback hardcoded
├── cron/
│   ├── bolao-engine.js      # Motor principal: abertura/fechamento/alertas automáticos
│   ├── sync-rounds.js       # Sincroniza jogos das 38 rodadas via TheSportsDB
│   ├── sync-scores.js       # Atualiza placares e finaliza rodadas
│   └── sync-teams.js        # Sincroniza times via TheSportsDB
├── evolution/
│   ├── sendText.js          # Proxy para envio de texto via EvolutionAPI
│   └── sendDocument.js      # Proxy para envio de PDF via EvolutionAPI (autenticado)
├── payments/
│   ├── woovi-charge.js      # Cria cobrança PIX na API da Woovi
│   ├── woovi-webhook.js     # Recebe confirmação de pagamento da Woovi
│   ├── simulate-pix.js      # Confirmação manual de PIX (autenticado, uso interno)
│   └── status.js            # Consulta status de transação por ID
└── services/
    └── footballApi.js       # Cliente TheSportsDB + API-Football
```

---

## Fluxo de Dados em Tempo Real

O sistema usa `onSnapshot` do Firestore para manter o estado sincronizado em tempo real sem necessidade de recarregar a página:

- `rounds` — rodadas atualizadas instantaneamente
- `teams` — times
- `predictions` — palpites
- `users` — participantes
- `establishments` — estabelecimentos
- `settings` — configurações globais
- `communications` — histórico de comunicados
- `team_import_requests` — solicitações de importação

---

## Considerações Operacionais

**Primeira inicialização:** Quando o banco está vazio, o sistema cria automaticamente 3 usuários de exemplo, os 20 times da Série A 2026 e o documento de configurações padrão. Um mecanismo de lock (`_locks/init`) evita dupla inicialização em caso de múltiplas abas abertas simultaneamente.

**Reentrega de webhooks:** O webhook da Woovi verifica se a cartela já está paga antes de processar, evitando notificações duplicadas em caso de reentrega.

**Rate limiting TheSportsDB:** O `sync-rounds` aguarda 800ms entre cada rodada sincronizada para respeitar os limites da API gratuita.

**Fechamento automático no cliente:** O admin logado realiza um polling a cada 30 segundos no cliente para fechar rodadas cujo `closeAt` passou, como redundância ao cron serverless.
