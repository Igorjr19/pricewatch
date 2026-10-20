/**
 * Shared extraction helpers (REQ-ADP-003, REQ-ADP-008).
 */

/** Integer cents from `R$ 1.234,56`, `1234,56`, `1.234` or a JSON number such as `1234.56`. */
export function parseBRL(
  input: string | number | null | undefined,
): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    return Number.isFinite(input) && input >= 0
      ? Math.round(input * 100)
      : null;
  }
  const cleaned = input.replace(/R\$|\s| /g, '');
  if (!/^\d[\d.,]*$/.test(cleaned)) return null;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized: string;
  if (lastComma !== -1) {
    // pt-BR: dots group thousands, the comma is the decimal separator.
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastDot !== -1 && cleaned.length - lastDot - 1 === 3) {
    // "1.234": a dot followed by exactly three digits is a thousands separator.
    normalized = cleaned.replace(/\./g, '');
  } else {
    normalized = cleaned;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

/** Parses the JSON inside `<script id="...">` (or the first script matching a regex on its content). */
export function extractEmbeddedJson(
  html: string,
  source: string | RegExp,
): unknown | null {
  let raw: string | undefined;
  if (typeof source === 'string') {
    const pattern = new RegExp(
      `<script[^>]*\\bid=["']${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>([\\s\\S]*?)</script>`,
      'i',
    );
    raw = pattern.exec(html)?.[1];
  } else {
    const match = source.exec(html);
    raw = match?.[1] ?? match?.[0];
  }
  if (raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Query parameters that only track the visit (REQ-ADP-002). */
const TRACKING = /^(utm_.*|ref|ref_|tag|gclid|fbclid|msclkid|mc_[a-z]+|_ga)$/i;

export function stripTracking(url: URL): URL {
  const clean = new URL(url);
  for (const key of [...clean.searchParams.keys()]) {
    if (TRACKING.test(key)) clean.searchParams.delete(key);
  }
  clean.hash = '';
  return clean;
}
