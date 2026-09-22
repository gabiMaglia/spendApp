// Valida un email editado a mano por el usuario antes de persistirlo.
// Regla mínima a propósito: no hay servidor que lo verifique (ADR-003), así
// que no tiene sentido más que confirmar la forma "algo@algo.algo".
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function sanitizeEmail(input: string): string | null {
  const trimmed = input.trim();
  return EMAIL_RE.test(trimmed) ? trimmed : null;
}
