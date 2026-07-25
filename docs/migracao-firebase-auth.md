# Migração para Firebase Auth + Regras do Firestore

Runbook da migração da autenticação (custom whatsapp+bcrypt no cliente) para
**Firebase Auth**, e ativação das **regras de segurança** do Firestore.

> Estado atual: código da migração pronto na branch `feat/firebase-auth`.
> NADA foi deployado. Os passos abaixo devem ser executados na ordem.

## Por que isso é necessário

Hoje o login roda 100% no navegador: o app lê a coleção `users` inteira e compara
a senha localmente. Não há `request.auth`, então as regras do Firestore só podem
ser "tudo liberado" ou "tudo bloqueado". Sem Firebase Auth, o banco não tem como
distinguir admin de usuário — qualquer pessoa com o console do navegador pode
ler senhas e alterar pagamentos. Firebase Auth é pré-requisito de tudo.

## Desenho

- **Email sintético**: cada usuário vira `<whatsapp-só-dígitos>@bolao.users` no Auth.
- **uid = ID do doc `/users`**: mantém vínculo 1:1; regras ficam triviais.
- **Admin**: custom claim `{ admin: true }` no token (não mais um campo confiável no doc).
- **Senhas preservadas**: `importUsers` importa os hashes bcrypt atuais — ninguém reseta senha.

## Passo a passo

### 1. Separar `/settings` (BLOQUEADOR do deploy das regras)

`/settings` mistura dados públicos (valor da aposta, chave PIX manual, modo
manutenção) com **segredos** (token Evolution, appId/secret Woovi). As regras novas
tornam `/settings` admin-only, o que quebraria o app do usuário comum.

Antes de deployar as regras:
- Criar doc `public_config` com apenas: `betValue`, `pixKey` (manual), `maintenanceMode`, `appUrl`.
- Apontar o app do usuário para `public_config` (hoje lê `settings` em `App.jsx`).
- Manter segredos só em `settings` (admin) e/ou variáveis de ambiente da Vercel.

> Caminho usado no DEV (sem service account): exportar usuários do Firestore e
> importar via Firebase CLI. Requer o CLI logado na conta DONA do projeto
> (no DEV foi `liontech.sup@gmail.com`, NÃO kirkpetri@gmail.com).

### 2. Ativar o provedor Email/Senha

Firebase Console → Authentication → **Começar** → Sign-in method →
**E-mail/senha: ativar → Salvar**.

### 3. Garantir que o CLI está logado na conta dona do projeto

```
firebase login:list
firebase projects:list --account <conta-dona>   # confirmar que o projeto aparece
```

Se necessário, numa janela de terminal interativa (não pelo `!` do Claude Code):
`firebase login:add` e faça login com a conta dona.

### 4. Exportar os usuários do Firestore

```
node scripts/export-users-for-import.mjs
```

Gera `users-import.json` (localId = ID do doc = uid; senhas bcrypt preservadas).
Arquivo sensível e no `.gitignore` — apague após importar.

### 5. Importar para o Firebase Auth

```
firebase auth:import users-import.json --hash-algo=BCRYPT --account <conta-dona>
```

Usuários com senha legada em texto plano são pulados no export (precisam redefinir).

### 6. Deploy do frontend

O `App.jsx` já usa `src/authService.js`. Fazer build e testar login com um usuário
real ANTES de mexer nas regras.

### 7. Deploy das regras

```
firebase deploy --only firestore:rules --account <conta-dona>
```

### 8. Validar

Rodar `node scripts/verify-rules.mjs` (entra como admin e como usuário descartável
e testa cada permissão). Também dá para validar manualmente no app:
- Usuário comum entra e vê rodadas/ranking, mas NÃO lê `/settings`.
- Usuário comum não vira admin nem marca palpite como pago.
- Admin acessa o painel normalmente.

## Rollback

Reverter o deploy do frontend (Vercel → Deployments → Promote anterior) e, se
necessário, republicar regras permissivas temporárias. Os dados do Firestore não
são alterados pela migração (só o Auth ganha usuários), então o rollback é seguro.

## Estado do código (cutover do App.jsx)

FEITO na branch `feat/firebase-auth`:
- `App.jsx` usa `authService`: login (`loginWithWhatsapp`), cadastro (`addUser` →
  `adminCreateUser` via app secundário), logout (`fbLogout`).
- Sessão trocada: saiu o token assinado em localStorage; entrou o observer
  `onAuthStateChanged`, que sincroniza `currentUser` com `/users/{uid}` e lê a
  claim `admin`. Mantido timeout de inatividade de 10 min por cima.
- Senha não é mais gravada no Firestore. Troca de senha própria via Firebase Auth.

Pendência que exige servidor (Admin SDK) — NÃO funciona só no cliente:
- Admin redefinir a senha DE OUTRO usuário (o `PasswordModal` do painel) agora
  lança erro pedindo "esqueci minha senha". Para reativar, criar um endpoint
  serverless com Admin SDK. Fluxo de recuperação de senha também precisa ser ligado.
- Criar usuário como admin (`isAdmin: true`) pelo painel NÃO concede privilégio
  real (a claim só é definida via Admin SDK / script de migração).

## Checklist pós-migração

- [x] Cutover do login no `App.jsx` para Firebase Auth.
- [x] Ativar provedor Email/Senha no console.
- [x] Importar usuários existentes (`firebase auth:import`).
- [x] "Esqueci minha senha" (serverless via WhatsApp) — `/api/auth/forgot-password`.
- [x] Endpoint admin para redefinir senha/editar usuário — `/api/admin/update-user`.
- [x] Backend migrado para Admin SDK (crons/webhook) — `_shared/firebaseAdmin.js` + shim.
- [x] Remover senhas dos docs `/users`.
- [x] Padronizar `CRON_SECRET` obrigatório.
- [x] Remover `simulate-pix.js` e `App.v1.jsx`.
- [ ] Limpar doc de admin duplicado (uid Tzquh6ATuw0LV30FXZHt — provável órfão).
- [ ] Push da branch `feat/firebase-auth` ao GitHub / merge no main (quando autorizado).
