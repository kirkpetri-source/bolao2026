// Validação de CPF/CNPJ. A Woovi exige taxID para criar assinatura, e recusar
// um documento inválido aqui evita uma ida à API que voltaria com erro genérico.
// Módulo sem dependências — o formulário do painel importa o mesmo validador.

function digitos(v) {
  return String(v || '').replace(/\D/g, '');
}

function cpfValido(cpf) {
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const [ate, pos] of [[9, 10], [10, 11]]) {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(cpf[i]) * (pos - i);
    let dv = (soma * 10) % 11;
    if (dv === 10) dv = 0;
    if (dv !== Number(cpf[ate])) return false;
  }
  return true;
}

function cnpjValido(cnpj) {
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (base) => {
    let peso = base.length - 7, soma = 0;
    for (let i = 0; i < base.length; i++) {
      soma += Number(base[i]) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(cnpj.slice(0, 12)) === Number(cnpj[12])
    && calc(cnpj.slice(0, 13)) === Number(cnpj[13]);
}

export function normalizeTaxId(valor) {
  return digitos(valor);
}

export function isTaxIdValido(valor) {
  const d = digitos(valor);
  if (d.length === 11) return cpfValido(d);
  if (d.length === 14) return cnpjValido(d);
  return false;
}

// Para exibir em tela e log sem despejar o documento inteiro.
export function mascaraTaxId(valor) {
  const d = digitos(valor);
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  if (d.length === 14) return `**.${d.slice(2, 5)}.${d.slice(5, 8)}/****-**`;
  return '';
}
