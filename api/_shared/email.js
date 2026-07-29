// Envio de e-mail transacional (Resend). Usado nos avisos de cobrança da
// assinatura, em paralelo ao WhatsApp — o organizador pode ter trocado de
// número, mas o e-mail do cadastro tende a ser estável.
import { Resend } from 'resend';

const REMETENTE = 'Bolão Brasileirão';

// O SDK da Resend NÃO lança exceção: devolve { data, error }. Envolver em
// try/catch e achar que está tratado é o engano clássico.
export async function sendEmail({ to, subject, html, idempotencyKey }) {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  const domain = (process.env.RESEND_EMAIL_DOMAIN || '').trim();

  if (!apiKey || !domain) {
    return { ok: false, motivo: 'Resend não configurado (RESEND_API_KEY/RESEND_EMAIL_DOMAIN ausentes)' };
  }
  if (!to) return { ok: false, motivo: 'destinatário vazio' };

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send(
    {
      // O domínio do remetente precisa bater EXATAMENTE com o verificado na
      // Resend, senão a API responde 403.
      from: `${REMETENTE} <financeiro@${domain}>`,
      to: [to],
      subject,
      html,
    },
    idempotencyKey ? { idempotencyKey } : undefined
  );

  if (error) return { ok: false, motivo: error.message || String(error) };
  return { ok: true, id: data?.id };
}

// Casca HTML simples e sóbria. E-mail transacional não precisa de firula, e
// tabela/inline style é o que sobrevive aos clientes de e-mail antigos.
export function layoutEmail({ titulo, paragrafos = [], botao }) {
  const corpo = paragrafos
    .map(p => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#374151;">${p}</p>`)
    .join('');

  const cta = botao
    ? `<p style="margin:22px 0 0;"><a href="${botao.url}" style="background:#008542;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block;">${botao.texto}</a></p>`
    : '';

  return `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:24px;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;">
    <tr><td style="padding:28px 28px 8px;">
      <p style="margin:0 0 18px;font-size:13px;letter-spacing:.18em;color:#008542;font-weight:700;">BOLÃO BRASILEIRÃO</p>
      <h1 style="margin:0 0 16px;font-size:21px;color:#0a0f1a;">${titulo}</h1>
      ${corpo}${cta}
    </td></tr>
    <tr><td style="padding:22px 28px 26px;">
      <p style="margin:0;font-size:12px;color:#9aa3b0;line-height:1.5;">
        Você recebe este aviso porque é o organizador de um bolão na plataforma.<br>
        Lion Tech Soluções em TI · liontechti.com.br
      </p>
    </td></tr>
  </table>
</body></html>`;
}
