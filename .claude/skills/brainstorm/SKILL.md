---
name: brainstorm
description: Sessão estruturada de brainstorm de melhorias para o sistema. Gera ideias categorizadas, prioriza por impacto x esforço e converte as escolhidas em plano de implementação.
---

# Brainstorm de melhorias — Bolão Brasileirão

Você vai conduzir uma sessão de brainstorm estruturada sobre o sistema deste repositório. Siga as etapas na ordem.

## Etapa 1 — Contexto

Antes de gerar ideias, revise rapidamente o estado atual:
- Leia `CLAUDE.md` e, se existir, `docs/` para entender regras de negócio.
- Considere o argumento passado pelo usuário (ex.: `/brainstorm pagamentos`) como TEMA. Sem argumento, o brainstorm é geral.

## Etapa 2 — Geração de ideias

Gere de 8 a 15 ideias distribuídas nestas categorias (pule categorias irrelevantes ao tema):

1. **Experiência do usuário** — fluxo de palpites, ranking, mobile, onboarding
2. **Receita / monetização** — novos formatos de bolão, planos, taxas, SaaS
3. **Segurança e confiabilidade** — auth, regras Firestore, backups, auditoria
4. **Automação** — crons, WhatsApp, apuração, cobrança
5. **Administração** — painel, relatórios, gestão de inadimplência
6. **Arquitetura / dívida técnica** — refatorações que destravam as demais

Regras:
- Cada ideia em 1–2 linhas, concreta o suficiente para virar tarefa.
- Nada de generalidades ("melhorar performance"); diga o quê e onde.

## Etapa 3 — Priorização

Monte uma tabela com colunas: **Ideia | Impacto (1–5) | Esforço (1–5) | Prioridade**.
- Prioridade = impacto alto + esforço baixo primeiro ("quick wins").
- Marque explicitamente os 3 melhores custo-benefício.

## Etapa 4 — Decisão

Use AskUserQuestion para o usuário escolher quais ideias seguir (multiSelect).

## Etapa 5 — Plano

Para cada ideia escolhida, produza um mini-plano: arquivos afetados, passos, riscos, como validar. Não implemente nada nesta skill — apenas entregue o plano e pergunte se deve executar.

## Estilo

- Português do Brasil, direto, sem emoji.
- Respeitar as convenções do projeto (Tailwind, App.jsx monolítico — cuidado ao propor refatorações).
