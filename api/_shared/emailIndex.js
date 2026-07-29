// Índice de unicidade de e-mail do organizador. Fica aqui, e não solto em quem
// grava, porque quem RESERVA e quem LIBERA precisam derivar exatamente o mesmo
// id — se as duas pontas divergirem, a liberação não encontra o documento e o
// e-mail fica travado para sempre.

// Id de documento derivado do e-mail: minúsculo, sem barra e dentro do limite
// de 1500 bytes do Firestore.
export function emailKey(email) {
  return String(email || '').toLowerCase().replace(/[^a-z0-9@._+-]/g, '_').slice(0, 200);
}

// Libera o e-mail para novo cadastro. Silencioso de propósito: excluir um
// usuário não pode falhar porque o índice já não existia.
export async function releaseEmail(db, email) {
  const chave = emailKey(email);
  if (!chave) return false;
  try {
    await db.collection('email_index').doc(chave).delete();
    return true;
  } catch (e) {
    console.error('emailIndex: falha ao liberar', chave, e.message);
    return false;
  }
}
