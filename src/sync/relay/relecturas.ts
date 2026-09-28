/**
 * Presupuesto de relectura acotada (T-191, Task 3, spec §7/§8 C6) — núcleo
 * puro, en memoria, sin storage: no sobrevive a un restart de la app, y no
 * hace falta que lo haga — es una defensa DENTRO de una sesión, no un
 * registro persistente.
 *
 * Por qué no se puede reusar `drainFailures.ts`: ese presupuesto cuenta por
 * `(topic, seq)`, y cada relectura desde el cursor 0 vuelve a traer el MISMO
 * `seq` que ya agotó su cupo ahí — o sea que no pondría ningún límite real a
 * las relecturas (spec §7 C6). Acá el contador es por
 * `(topic, sender, seq del MANIFIESTO)`: como máximo UNA relectura por
 * versión de manifiesto declarada. Si después de releer sigue faltando algo,
 * `drainGroup` lo registra en `manifestHealth` y no vuelve a intentar hasta
 * que llegue un manifiesto con un `seq` distinto.
 */

const usados = new Set<string>();

function clave(topic: string, sender: string, seqManifiesto: number): string {
  return `${topic}\u0000${sender}\u0000${seqManifiesto}`;
}

/**
 * ¿Se puede releer `(topic, sender)` para este `seqManifiesto`? Primera
 * llamada para esa terna: sí, y la consume — llamadas siguientes para la
 * MISMA terna: no, hasta que aparezca un manifiesto con otro `seq`.
 */
export function permite(topic: string, sender: string, seqManifiesto: number): boolean {
  const k = clave(topic, sender, seqManifiesto);
  if (usados.has(k)) return false;
  usados.add(k);
  return true;
}

/** Sólo para tests: limpia todo el presupuesto consumido. */
export function _reset(): void {
  usados.clear();
}
