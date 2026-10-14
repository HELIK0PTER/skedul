/**
 * Development aid for the mock e-mail log (src/lib/email.ts): the absolute
 * links of a mail body, so a developer can follow the personal link or the
 * calendar file link without a mailbox. Pure; decodes the entities
 * escapeHtml put in an href.
 */

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Absolute http(s) hrefs of the `<a>` tags of `html`, first-seen order, no repeat, at most `max`. */
export function mockLinks(html: string, max = 5): string[] {
  const links: string[] = [];
  const anchor = /<a\s[^>]*?href="([^"]+)"/gi;
  let match: RegExpExecArray | null;
  while (links.length < max && (match = anchor.exec(html)) !== null) {
    const href = decodeEntities(match[1]);
    if (/^https?:\/\//i.test(href) && !links.includes(href)) links.push(href);
  }
  return links;
}
