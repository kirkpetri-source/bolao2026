# Guia do Projeto para Claude Code – Bolão Brasileirão 2025 (Ambiente DEV)

Este documento serve como a base de conhecimento e diretrizes de sistema para o **Claude Code** ao atuar no repositório do **Bolão Brasileirão 2025 (Dev)**.

---

## 🎯 Visão Geral do Sistema
Sistema completo de gestão de bolão para o Campeonato Brasileiro de 2025. Permite aos usuários cadastrarem palpites por rodada, visualizarem rankings e realizarem pagamentos das cartelas. O painel do administrador gerencia rodadas, status de pagamentos, envio de comunicados via WhatsApp e apuração de resultados.

---

## 💻 Tech Stack
- **Frontend:** React 18, Vite, Tailwind CSS, Lucide Icons.
- **Backend & Database:** Firebase Auth, Firestore (banco de dados em tempo real).
- **Serverless / Funções de Backend:** Vercel Serverless Functions (localizadas na pasta `/api`).
- **Testes:** Vitest.

---

## 📁 Arquitetura e Estrutura de Pastas

```text
bolao-brasileirao-2025-dev/
├── api/                       # Vercel Serverless Functions
│   ├── brasileirao/teams.js   # Importação/gestão de times
│   ├── cron/bolao-engine.js   # Motor de automação de rodadas e encerramentos
│   ├── evolution/sendText.js  # Proxy para envio de mensagens via EvolutionAPI (WhatsApp)
│   └── payments/              # Simulação e status de pagamentos PIX
├── docs/                      # Documentações internas
├── src/
│   ├── App.jsx                # Componente central contendo UI de Admin, Usuários e Estado global
│   ├── main.jsx               # Ponto de entrada React
│   ├── index.css              # Estilos globais e diretivas do Tailwind
│   └── utils/
│       ├── messageTemplates.js # Modelos de comunicados e substituição de tags
│       └── payments.js        # Utilitários de manipulação de pagamentos
└── vercel.json                # Configurações de rotas e headers de segurança para Vercel
```

---

## ⚙️ Regras de Negócio Importantes

### 1. Pagamentos PIX (Fluxo Manual)
- **Sem Gateway Externo Automático:** O sistema utiliza o provedor `pix_manual` configurado no painel do administrador com a chave PIX do organizador.
- **Experiência do Usuário:** Ao clicar em pagar, o sistema exibe a chave PIX e botões para copiar a chave ou enviar o comprovante via WhatsApp para o administrador.
- **Validação pelo Admin:** O administrador confere o comprovante e altera o status da cartela (`pago` / `não pago`) diretamente no painel.
- **Auditoria:** Toda alteração de status de pagamento gera um log de auditoria na coleção `admin_events` do Firestore.

### 2. Integração de WhatsApp (EvolutionAPI)
- **Proxy Serverless:** Para evitar erros de certificado no navegador em requisições a instâncias da EvolutionAPI (ex: `*.sslip.io`), o envio de mensagens passa por `/api/evolution/sendText`.
- **Comunicados:** O painel possui uma interface unificada de cartões clicáveis com modelos pré-prontos. Suporta tags dinâmicas como `{PIX}`.

---

## 🚀 Comandos de Desenvolvimento

- **Instalar dependências:**
  ```bash
  npm install
  ```
- **Rodar servidor de desenvolvimento local:**
  ```bash
  npm run dev
  ```
- **Fazer o build para produção:**
  ```bash
  npm run build
  ```
- **Rodar testes:**
  ```bash
  npm run test
  ```

---

## 📝 Convenções de Código
- **ES Modules:** O projeto utiliza `"type": "module"` no `package.json`.
- **Estilização:** Manter estritamente o uso de classes utilitárias do **Tailwind CSS**.
- **Cuidado com `App.jsx`:** O arquivo central concentra a maior parte da lógica de visualização e estados. Ao propor refatorações ou correções, certifique-se de não quebrar os fluxos existentes de Admin e Usuários.
