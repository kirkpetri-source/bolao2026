// Regras de senha do sistema, num lugar só.
//
// Antes o único critério era "mínimo 6 caracteres", que é o mínimo do Firebase
// Auth — ou seja, não havia regra nossa. Com WhatsApp como identificador, a
// senha fraca é o único obstáculo entre um estranho e a cartela (e o histórico
// de pagamento) de um participante: o "usuário" é público, está no grupo.
//
// O que exigimos e por quê:
// - 8 caracteres: 6 dígitos é o tamanho de uma data de nascimento e cabe em
//   ataque de força bruta trivial;
// - não pode ser só número: data de nascimento e telefone são o primeiro chute;
// - não pode conter o próprio WhatsApp nem o nome: é o dado que o atacante já tem;
// - não pode ser uma das senhas mais usadas do Brasil.
//
// O que NÃO exigimos, de propósito: símbolo obrigatório e maiúscula obrigatória.
// Regra decorativa empurra o usuário para "Senha@123" e para o papelzinho colado
// no monitor. Tamanho e imprevisibilidade valem mais.
//
// Sem dependências: o formulário do navegador e o endpoint do servidor validam
// com o MESMO código — senão o cliente barra e a API aceita.

export const MIN_SENHA = 8;

// Lista curta e prática: as que aparecem em toda tabela de senhas vazadas no
// Brasil, mais as óbvias de bolão.
const PROIBIDAS = new Set([
  '12345678', '123456789', '1234567890', '123456', '1234567', 'senha123',
  'password', 'password1', 'senha1234', 'abcd1234', 'qwertyui', 'qwerty123',
  'brasil123', 'flamengo', 'corinthians', 'bolao123', 'futebol1', '11111111',
  'admin123', 'mudar123', 'primeiro', 'teste123',
]);

function somenteDigitos(s) { return /^\d+$/.test(s); }

function todosIguais(s) { return /^(.)\1+$/.test(s); }

function sequencial(s) {
  const baixa = s.toLowerCase();
  const seqs = '0123456789abcdefghijklmnopqrstuvwxyz';
  for (let i = 0; i + baixa.length <= seqs.length; i++) {
    const trecho = seqs.slice(i, i + baixa.length);
    if (baixa === trecho || baixa === [...trecho].reverse().join('')) return true;
  }
  return false;
}

// Devolve { ok, erro } — `erro` é a mensagem pronta para a tela.
export function validaSenha(senha, { whatsapp = '', nome = '' } = {}) {
  const s = String(senha || '');

  if (s.length < MIN_SENHA) {
    return { ok: false, erro: `A senha precisa ter pelo menos ${MIN_SENHA} caracteres.` };
  }
  if (todosIguais(s)) {
    return { ok: false, erro: 'A senha não pode ser o mesmo caractere repetido.' };
  }
  if (sequencial(s)) {
    return { ok: false, erro: 'A senha não pode ser uma sequência (12345678, abcdefgh).' };
  }
  if (somenteDigitos(s)) {
    return { ok: false, erro: 'Não use só números: misture letras, para não virar uma data de nascimento.' };
  }
  if (PROIBIDAS.has(s.toLowerCase())) {
    return { ok: false, erro: 'Essa senha é muito comum e está em listas de vazamento. Escolha outra.' };
  }

  const numeros = String(whatsapp || '').replace(/\D/g, '');
  if (numeros.length >= 6 && s.includes(numeros.slice(-8))) {
    return { ok: false, erro: 'A senha não pode conter o seu WhatsApp — é o dado que todo mundo já tem.' };
  }

  const primeiroNome = String(nome || '').trim().split(/\s+/)[0] || '';
  if (primeiroNome.length >= 4 && s.toLowerCase().includes(primeiroNome.toLowerCase())) {
    return { ok: false, erro: 'A senha não pode conter o seu nome.' };
  }

  return { ok: true, erro: '' };
}

// Força de 0 a 4, só para o medidor da tela orientar. Não bloqueia nada: o que
// bloqueia é validaSenha.
export function forcaSenha(senha) {
  const s = String(senha || '');
  if (!s) return { nivel: 0, rotulo: '' };

  let pontos = 0;
  if (s.length >= MIN_SENHA) pontos++;
  if (s.length >= 12) pontos++;
  if (/[a-zA-Z]/.test(s) && /\d/.test(s)) pontos++;
  if (/[^a-zA-Z0-9]/.test(s)) pontos++;
  if (todosIguais(s) || sequencial(s) || PROIBIDAS.has(s.toLowerCase())) pontos = 0;

  const nivel = Math.min(4, pontos);
  return { nivel, rotulo: ['Muito fraca', 'Fraca', 'Razoável', 'Boa', 'Forte'][nivel] };
}
