# Procedimento de Importação de Times (Seguro)

Objetivo: impedir criação automática/duplicada de times e exigir aprovação explícita do administrador.

Fluxo resumido:
- Endpoint `GET /api/brasileirao/teams` apenas retorna dados normalizados (`name`, `logo`, `normalizedName`). Não escreve no banco.
- No painel Admin, aba Times, use o botão “Buscar times da API” para criar solicitações em `team_import_requests` com `status=pending` apenas para nomes não existentes.
- O administrador aprova cada solicitação. A aprovação cria o time em `teams` e atualiza a solicitação para `status=approved`.
- Rejeições atualizam para `status=rejected` e registram motivo.

Auditoria e alertas:
- Toda ação relevante registra logs em `audit_logs` (`team_import_requested`, `team_import_approved`, `team_import_rejected`, tentativas não autorizadas em `unauthorized_action`).
- Apenas usuários com `isAdmin=true` conseguem criar, aprovar ou rejeitar.

Boas práticas:
- Antes de aprovar, verifique se o nome está correto e não conflita com times já usados em rodadas.
- Use “Corrigir duplicados” para unificar nomes em caso de problemas pré-existentes.
- Evite aprovar solicitações em massa sem revisão — mantenha o controle manual.

Recuperação de falhas:
- Se uma aprovação falhar por nome já existir, corrija duplicados primeiro e reaprovação depois.
- Em caso de erro de API, o endpoint usa lista fallback; as solicitações continuarão seguras e manuais.