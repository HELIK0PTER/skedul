/**
 * The client address and its rate-limit buckets (spec § 12, OUT:109, SEC-I1). Pure: the headers are
 * read through the object the caller passes, and a bucket is only ever hashed (src/lib/visitor-hash.ts
 * `ipHash`) before it reaches the `throttle` table.
 */

type HeaderReader = { get(name: string): string | null };

/** The first entry of a comma-separated header value, trimmed; null when empty or absent. */
function firstEntry(value: string | null): string | null {
  if (value === null) return null;
  const first = value.split(",")[0].trim();
  return first === "" ? null : first;
}

/** The client address: x-vercel-forwarded-for, else the first x-forwarded-for entry, else x-real-ip (trimmed); null when none is set. Vercel overwrites these headers at its edge. */
export function clientIpFrom(headers: HeaderReader): string | null {
  return (
    firstEntry(headers.get("x-vercel-forwarded-for")) ??
    firstEntry(headers.get("x-forwarded-for")) ??
    firstEntry(headers.get("x-real-ip"))
  );
}

type ParsedIp = { kind: "v4"; text: string } | { kind: "v6"; groups: number[] };

const V4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const V6_PIECE_RE = /^[0-9a-f]{1,4}$/;

/** A dotted IPv4 address in canonical decimal form, or null. */
function parseV4(text: string): string | null {
  const match = V4_RE.exec(text);
  if (!match) return null;
  const octets = [match[1], match[2], match[3], match[4]].map(Number);
  return octets.every((n) => n <= 255) ? octets.join(".") : null;
}

/** The groups of one side of an IPv6 address; an embedded IPv4 tail is accepted only when `allowV4Tail`. */
function groupsOf(part: string, allowV4Tail: boolean): number[] | null {
  if (part === "") return [];
  const pieces = part.split(":");
  const out: number[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    if (allowV4Tail && i === pieces.length - 1 && piece.includes(".")) {
      const v4 = parseV4(piece);
      if (v4 === null) return null;
      const octets = v4.split(".").map(Number);
      out.push(octets[0] * 256 + octets[1], octets[2] * 256 + octets[3]);
      continue;
    }
    if (!V6_PIECE_RE.test(piece)) return null;
    out.push(parseInt(piece, 16));
  }
  return out;
}

/** The eight 16-bit groups of a lower-case IPv6 text without brackets or zone, or null. */
function parseV6(text: string): number[] | null {
  if (!text.includes(":") || !/^[0-9a-f:.]+$/.test(text)) return null;
  const gap = text.indexOf("::");
  if (gap !== text.lastIndexOf("::")) return null;
  if (gap < 0) {
    const groups = groupsOf(text, true);
    return groups !== null && groups.length === 8 ? groups : null;
  }
  const head = groupsOf(text.slice(0, gap), false);
  const tail = groupsOf(text.slice(gap + 2), true);
  if (head === null || tail === null) return null;
  const missing = 8 - head.length - tail.length;
  return missing >= 1 ? [...head, ...Array<number>(missing).fill(0), ...tail] : null;
}

/** An address as an IPv4 text or eight IPv6 groups; an IPv4-mapped IPv6 address is read as the IPv4 address it carries. */
function parseIp(raw: string | null): ParsedIp | null {
  if (raw === null) return null;
  let text = raw.trim().toLowerCase();
  if (text === "" || text.length > 64) return null;
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  const v4 = parseV4(text);
  if (v4 !== null) return { kind: "v4", text: v4 };
  const groups = parseV6(text);
  if (groups === null) return null;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return { kind: "v4", text: [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join(".") };
  }
  return { kind: "v6", groups };
}

/** The first `n` groups as « a:b:c », each without leading zeros. */
function prefixOf(groups: number[], n: number): string {
  return groups.slice(0, n).map((g) => g.toString(16)).join(":");
}

/** The narrow bucket of a parsed address: the IPv4 text, or the IPv6 /64; "unknown" for null. */
function narrowOf(parsed: ParsedIp | null): string {
  if (parsed === null) return "unknown";
  return parsed.kind === "v4" ? parsed.text : `${prefixOf(parsed.groups, 4)}::/64`;
}

/** The rate-limit bucket (OUT:109): IPv4 as is (also out of "::ffff:a.b.c.d"), IPv6 lower-cased, "[…]" and "%zone" stripped, "::" expanded, cut to its first 4 groups + "::/64"; "unknown" for null or anything unparsable. */
export function ipBucket(ip: string | null): string {
  return narrowOf(parseIp(ip));
}

/** narrow = ipBucket(ip); wide = the IPv6 /48 (first 3 groups + "::/48"), null for IPv4, "unknown" or null input (SEC-I1). The address is parsed once. */
export function ipBuckets(ip: string | null): { narrow: string; wide: string | null } {
  const parsed = parseIp(ip);
  return {
    narrow: narrowOf(parsed),
    wide: parsed !== null && parsed.kind === "v6" ? `${prefixOf(parsed.groups, 3)}::/48` : null,
  };
}
