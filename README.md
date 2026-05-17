# Bolão Brasileirão 2025

Sistema completo de bolão para o Campeonato Brasileiro 2025.

## Instalação
```bash
npm install
```

## Desenvolvimento
```bash
npm run dev
```

## Build
```bash
npm run build
```

## Tecnologias
- React 18
- Vite
- Firebase/Firestore
- Tailwind CSS
- Lucide Icons

## Pagamentos via PIX (Manual)
- O fluxo de pagamento foi migrado para PIX manual, sem integrações externas.
- Como configurar:
  - Acesse "Configurações > Pagamentos" no painel administrativo.
  - Informe a sua `chave PIX` (CPF/CNPJ, email, telefone ou chave aleatória).
  - O provedor é `pix_manual` por padrão, não há OAuth.
- Como funciona para o usuário:
  - Ao clicar em pagar, o modal exibe a chave PIX e instruções.
  - Botões disponíveis: `Copiar chave` e `Copiar mensagem para WhatsApp` (para enviar comprovante ao administrador).
  - Não há QR Code nem verificação automática; a validação é feita pelo administrador.
- Como funciona para o administrador:
  - No painel, altere o status `pago/não pago` de uma cartela quando receber o comprovante.
  - Cada alteração gera um log de auditoria em `admin_events` (com cartela, rodada, usuário e novo status).
- Templates de mensagens:
  - Os modelos aceitam a tag `{PIX}` para inserir a chave PIX dinâmica.
  - Atualize os comunicados usando a seção de "Comunicados" conforme necessário.

## Comunicados – Consolidação de Modelos
- A UI de "Comunicados" foi simplificada removendo a duplicação entre "Seleção rápida de modelos" (rádio) e "Modelos prontos".
- Agora existe um único bloco de modelos com cartões clicáveis:
  - Clique em qualquer cartão para inserir rapidamente o texto do modelo.
  - Os botões "Inserir" e "Copiar texto puro" permanecem disponíveis em cada cartão.
  - O modelo "Resultado Final" fica desabilitado quando a rodada selecionada não está "Finalizada".
- Nenhuma funcionalidade foi removida; referências internas foram mantidas e o método `applyTemplate` continua responsável por gerar e aplicar o texto.
- Teste no dev server com `npm run dev` e acesse a seção "Comunicados".

## Proxy EvolutionAPI (WhatsApp)
- Problema: navegadores bloqueiam hosts com certificado inválido (ERR_CERT_AUTHORITY_INVALID), comuns em endpoints como `*.sslip.io`.
- Solução provisória: um endpoint serverless (`/api/evolution/sendText`) faz o POST ao EvolutionAPI no backend e tolera certificados inválidos.
- Funcionamento:
  - O frontend usa o proxy automaticamente em produção (não localhost).
  - O proxy recebe `number`, `text`, `link`, `instance`, `token` e repassa ao EvolutionAPI.
  - Em DEV local, o app chama o EvolutionAPI diretamente.
- Segurança: idealmente, configure um domínio com TLS válido (Let’s Encrypt/Cloudflare) e remova a tolerância a certificados inválidos.
