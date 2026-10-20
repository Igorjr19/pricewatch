/** `123:ABCDEF` → `123:***` style masking (REQ-CFG-004): keep at most 4 leading characters. */
export function maskSecret(secret: string): string {
  return secret.length <= 4 ? '***' : `${secret.slice(0, 4)}***`;
}

/** Replaces every occurrence of each secret in `text`, so error messages never leak credentials. */
export function redact(text: string, secrets: string[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret.length >= 3) result = result.split(secret).join('***');
  }
  return result;
}
