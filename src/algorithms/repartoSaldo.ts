import type { CurrencyCode } from '@/src/constants/currencies';

/**
 * A quién y cuánto se le paga al saldar en un grupo (ADR-006, decisión 2).
 *
 * > Se rinde a una persona. En un grupo, si rendís, tenés que rendir el total
 * > sí o sí. Si hay más de un involucrado y no podés cubrir el máximo, elegís
 * > cuánto le das a cada uno: puede ser todo por igual, o lo que quieras a
 * > quien quieras.
 *
 * La regla que ordena todo esto: **la app nunca decide sola a quién se le
 * paga**. Puede ofrecer un reparto parejo como atajo, pero repartir plata
 * entre acreedores es una decisión de la persona, no una regla de negocio.
 */
export type Acreedor = { userId: string; amount: number };
export type Reparto = { userId: string; amount: number };

/**
 * A quiénes les debo en este grupo, de mayor a menor.
 *
 * El orden es estable y explicable —la deuda más grande primero, y el id
 * desempata— para que la pantalla no baile entre renders.
 */
export function acreedoresDe(
  balances: { userId: string; amount: number }[],
  me: string,
): Acreedor[] {
  const yo = balances.find(b => b.userId === me);
  if (!yo || yo.amount >= 0) return [];   // no debo nada: no hay a quién pagarle

  return balances
    .filter(b => b.userId !== me && b.amount > 0)
    .map(b => ({ userId: b.userId, amount: b.amount }))
    .sort((a, b) => b.amount - a.amount || a.userId.localeCompare(b.userId));
}

/** Lo que hace falta para saldar TODO lo que debo en el grupo. */
export function totalAdeudado(acreedores: Acreedor[]): number {
  return acreedores.reduce((s, a) => s + a.amount, 0);
}

/**
 * Reparto parejo, como ATAJO — nunca como default silencioso.
 *
 * Con enteros en menor unidad la división no siempre es exacta. El resto se
 * entrega de a un centavo a los primeros de la lista, que ya viene ordenada de
 * mayor a menor: así la suma da EXACTO y quien más presta cobra el centavo de
 * más, que es lo defendible si alguien pregunta.
 */
export function repartoParejo(acreedores: Acreedor[], disponible: number): Reparto[] {
  if (acreedores.length === 0 || disponible <= 0) return [];

  const total = totalAdeudado(acreedores);
  if (disponible >= total) return acreedores.map(a => ({ ...a }));  // alcanza para todos

  const base = Math.floor(disponible / acreedores.length);
  let resto = disponible - base * acreedores.length;

  return acreedores.map(a => {
    // Nunca más de lo que se le debe: repartir parejo no puede convertirse en
    // pagarle de más a quien poco prestó.
    const extra = resto > 0 ? 1 : 0;
    const monto = Math.min(a.amount, base + extra);
    if (extra) resto -= 1;
    return { userId: a.userId, amount: monto };
  }).filter(r => r.amount > 0);
}

/** ¿Un reparto hecho a mano es válido? */
export function repartoValido(
  reparto: Reparto[],
  acreedores: Acreedor[],
  disponible: number,
): { ok: true } | { ok: false; motivo: 'excede_disponible' | 'excede_deuda' | 'vacio' } {
  const suma = reparto.reduce((s, r) => s + r.amount, 0);
  if (suma <= 0) return { ok: false, motivo: 'vacio' };
  if (suma > disponible) return { ok: false, motivo: 'excede_disponible' };

  const deuda = new Map(acreedores.map(a => [a.userId, a.amount]));
  for (const r of reparto) {
    // Pagarle a alguien más de lo que se le debe no salda: mueve la deuda al
    // otro lado y deja al usuario acreedor sin haberlo pedido.
    if (r.amount > (deuda.get(r.userId) ?? 0)) return { ok: false, motivo: 'excede_deuda' };
  }
  return { ok: true };
}

/** Los pagos que hay que crear a partir de un reparto. */
export function pagosDelReparto(
  reparto: Reparto[],
  me: string,
  groupId: string,
  currency: CurrencyCode,
): { fromUserId: string; toUserId: string; amount: number; groupId: string; currency: CurrencyCode }[] {
  return reparto
    .filter(r => r.amount > 0)
    .map(r => ({ fromUserId: me, toUserId: r.userId, amount: r.amount, groupId, currency }));
}
