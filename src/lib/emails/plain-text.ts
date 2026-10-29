/**
 * The text part of a mail, read off its HTML (P6 A26). A mail with an HTML part only reads as spam to some filters,
 * and some readers (a text-only client, a screen reader set to plain text, a watch) show nothing of it: every mail
 * src/lib/email.ts sends carries this text too. Pure, and written for the markup our templates make
 * (src/lib/email-layout.ts, src/lib/emails/parts.ts): paragraphs, line breaks, label / value tables and links, not
 * for any HTML.
 */

const NAMED: Record<string, string> = { lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", amp: "&" };

/** Every entity read once: the named ones escapeHtml writes (and &nbsp;), decimal and hexadecimal; an unknown one stays. */
export function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (entity, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (dec !== undefined) return String.fromCodePoint(Number(dec));
    if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16));
    return NAMED[name!.toLowerCase()] ?? entity;
  });
}

/** The address of an `<a>` tag's href, decoded, or null. */
function hrefOf(tag: string): string | null {
  const match = /\shref="([^"]*)"/i.exec(tag);
  return match ? decodeEntities(match[1]) : null;
}

/**
 * The HTML as lines a person reads: what is never shown goes (head, style, script, comments), a block starts a line,
 * a paragraph or a heading ends with a blank line after it, a `<br>` or a table row ends a line, the cells of a row read
 * « label : value », a link reads « label : address » (the address alone when it is its own label). Tags are dropped
 * before the entities are read, so an escaped « <b> » someone typed stays text. Spaces collapse, lines are trimmed,
 * blank lines never pile up.
 */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(head|style|script)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<!doctype[^>]*>/gi, "")
    // Buttons side by side (the calendar links) each get their own line.
    .replace(/<\/a\s*>\s*(?=<a\b)/gi, "</a><br>")
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (_all, attrs: string, inner: string) => {
      const label = inner.replace(/<[^>]*>/g, "").trim();
      const href = hrefOf(` ${attrs}`);
      if (href === null || href === "") return label;
      return label === "" || decodeEntities(label) === href ? reescape(href) : `${label} : ${reescape(href)}`;
    })
    .replace(/\s+/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]\s*>\s*<t[dh]\b[^>]*>/gi, " : ")
    .replace(/<\/(?:tr|li|div)\s*>/gi, "\n")
    .replace(/<\/(?:p|h[1-6]|table|ul|ol)\s*>/gi, "\n\n")
    // A block opens on a line of its own, even right after a link that sat outside any paragraph.
    .replace(/<(?:p|div|h[1-6]|table|tr|ul|ol)\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A decoded address put back in the markup until the last pass: its « & » must not start an entity, nor a « < » a tag. */
function reescape(href: string): string {
  return href.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
