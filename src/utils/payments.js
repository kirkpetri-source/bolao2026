// Utilidades simples para pagamentos e WhatsApp
export const formatDateTimeBR = (date) => {
  try {
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  } catch {
    return (date || new Date()).toLocaleString('pt-BR');
  }
};

export const normalizeWhatsapp = (s) => {
  const d = String(s || '').replace(/\D/g, '');
  return d.length > 11 ? d.slice(-11) : d; // DDD + número (Brasil)
};

export const composeReceiptMessage = ({ roundName, nParticipations, amountBRL, when, txId }) => {
  const lines = [
    '✅ Pagamento confirmado!',
    '',
    `Rodada: ${roundName || ''}`,
    `Participações: ${Number(nParticipations || 0)}`,
    `Valor pago: ${amountBRL || ''}`,
    `Data/hora: ${formatDateTimeBR(when || new Date())}`,
    `Transação: ${txId || ''}`,
    '',
    'Obrigado pela participação! 🎉'
  ];
  return lines.join('\n');
};
