/**
 * Shared HTML frame and escaping for transactional e-mails. Pure (no Resend,
 * no server-only), so the templates built on it can be unit-tested.
 */

export function layout(title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#18181b">
  <div style="max-width:520px;margin:0 auto;padding:32px 16px">
    <div style="font-weight:700;font-size:20px;color:#6366f1;margin-bottom:16px">Skedul</div>
    <div style="background:#fff;border-radius:16px;padding:28px;border:1px solid #e4e4e7">
      <h1 style="font-size:18px;margin:0 0 12px">${title}</h1>
      ${body}
    </div>
    <p style="color:#a1a1aa;font-size:12px;text-align:center;margin-top:20px">Envoyé par Skedul · Réservations & packs prépayés</p>
  </div></body></html>`;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
