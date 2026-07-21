// Valida un nombre editado por el usuario antes de persistirlo.
// Reglas T-008: no permitir nombre vacío ni compuesto solo de espacios.
export function sanitizeUserName(input: string): string | null {
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}
