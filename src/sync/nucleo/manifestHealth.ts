/**
 * Estado de "¿este grupo tiene todas las rebanadas que su manifiesto
 * declara?", en memoria — mismo patrón que publishHealth.ts: diagnóstico del
 * momento, no un dato persistido del usuario.
 *
 * Un gap acá NUNCA es motivo para descartar, revertir o dejar de aplicar las
 * rebanadas que sí llegaron bien — sólo es información para avisar en la UI
 * más tarde (T-085/Task 7). `drainGroup` aplica igual, LWW y el merge existente
 * ya manejan un estado parcial o desactualizado del buzón con seguridad. Ver
 * el hallazgo de la revisión de Task 5: un publish no es atómico, así que un
 * manifiesto viejo/incompleto en el buzón es un caso esperado, no un error.
 */
export type ManifestGap = { groupId: string; missingCkeys: string[]; at: number };

const gaps = new Map<string, ManifestGap>();

/** Registra el resultado de un chequeo. Sin faltantes, borra el gap anterior. */
export function recordManifestCheck(groupId: string, missingCkeys: string[]): void {
  if (missingCkeys.length === 0) {
    gaps.delete(groupId);
    return;
  }
  gaps.set(groupId, { groupId, missingCkeys, at: Date.now() });
}

export function manifestGapFor(groupId: string): ManifestGap | null {
  return gaps.get(groupId) ?? null;
}

/** Sólo para tests. */
export function clearManifestGaps(): void {
  gaps.clear();
}
