export function marginMultiplierToPercent(value: unknown): number {
  return Math.round((Math.max(0.01, Number(value) || 1.1) - 1) * 10000) / 100;
}

export function marginPercentToMultiplier(value: unknown): number {
  return 1 + Math.max(0, Number(value) || 0) / 100;
}

export function customerMarginPercent(defaultMargin: unknown, fallback = 10): string {
  const numeric = Number(defaultMargin);
  return Number.isFinite(numeric)
    ? String(Math.round(Math.max(0, numeric) * 10000) / 100)
    : String(fallback);
}
