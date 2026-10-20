const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** Parses `30s`, `15m`, `3h`, `1d` into milliseconds (REQ-CFG-003). Returns null when invalid. */
export function parseDuration(input: string): number | null {
  const match = /^(\d+)([smhd])$/.exec(input.trim());
  if (!match) return null;
  const value = Number(match[1]);
  if (value <= 0) return null;
  return value * UNIT_MS[match[2] as keyof typeof UNIT_MS];
}
