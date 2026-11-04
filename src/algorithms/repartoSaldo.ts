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

  // Reparto parejo con tope por acreedor: a quien se le debe menos que su parte
  // se le paga lo suyo y el sobrante se reparte entre los demás (de menor a
  // mayor deuda), así la suma da EXACTO lo que la persona escribió.
  const orden = acreedores.map((_, i) => i).sort((i, j) => acreedores[i].amount - acreedores[j].amount || i - j);
  const montos = new Map<number, number>();
  let resta = disponible;
  let k = orden.length;
  for (let n = 0; n < orden.length; n++, k--) {
    const i = orden[n];
    const parte = Math.floor(resta / k);
    if (acreedores[i].amount <= parte) {
      montos.set(i, acreedores[i].amount);
      resta -= acreedores[i].amount;
      continue;
    }
    // Nadie de acá en más está topado: parte entera para todos y el resto, de a
    // un centavo, a los primeros de la lista original (ya viene de mayor a menor).
    const quedan = orden.slice(n).sort((x, y) => x - y);
    let extra = resta - parte * k;
    for (const q of quedan) {
      montos.set(q, parte + (extra > 0 ? 1 : 0));
      if (extra > 0) extra -= 1;
    }
    break;
  }

  return acreedores
    .map((a, i) => ({ userId: a.userId, amount: montos.get(i) ?? 0 }))
    .filter(r => r.amount > 0);
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
