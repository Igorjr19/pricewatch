/** `195000` → `R$ 1.950,00` (REQ-ALR-020). Plain space, not the NBSP that Intl would emit. */
export function formatBRL(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const reais = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const centavos = (abs % 100).toString().padStart(2, '0');
  return `${sign}R$ ${reais},${centavos}`;
}

export function reasonTargetPrice(
  effectiveCents: number,
  targetCents: number,
): string {
  const relation = effectiveCents < targetCents ? 'abaixo do' : 'igual ao';
  return `Melhor preço ${formatBRL(effectiveCents)} ${relation} alvo ${formatBRL(targetCents)}`;
}

export function reasonNewLow(
  effectiveCents: number,
  previousLowCents: number,
): string {
  return `Menor preço já registrado: ${formatBRL(effectiveCents)} (anterior ${formatBRL(previousLowCents)})`;
}

export function reasonBackInStock(effectiveCents: number | null): string {
  return effectiveCents === null
    ? 'Voltou ao estoque'
    : `Voltou ao estoque por ${formatBRL(effectiveCents)}`;
}
