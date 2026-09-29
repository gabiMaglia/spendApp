import type { CurrencyCode } from '@/src/constants/currencies';
import type { Expense, Payment } from '@/src/types/models';
import { convertMinorAmount } from '@/src/algorithms/calculateBalances';
import { expensePayers } from '@/src/algorithms/payers';
import { idCanonico, rosterCanonico } from '@/src/store/identityAlias';

/**
 * **Deuda por par, sin compensar** (T-225, PO 2026-09-29 — enmienda ADR-006 d1).
 *
 * ADR-006 ya decía que lo que le debo a alguien y lo que me debe son dos hechos
 * distintos, pero dentro de un grupo se seguían compensando (`simplifyDebts`
 * por grupo). Con un grupo de dos personas, cuatro gastos a favor (200) y uno
 * en contra (60), la app mostraba «Te deben 140 · Debés 0»: los 60 que debía el
 * PO desaparecían. Acá cada dirección se lleva por separado y cada una baja
 * sólo con su propio pago.
 *
 * Invariante (test de propiedad): para cada persona, Σ lo que le deben − Σ lo
 * que debe = su neto de `calculateBalancesByCurrency`. El total no cambia; sólo
 * deja de esconder una de las dos mitades.
 *
 * Una deuda con alguien que ya no está en el roster no se cuenta: no hay a
 * quién pagársela desde el grupo (mismo criterio que el neto, que ignora ids
 * fuera del roster al acreditar).
 */
export type DeudaPar = { deudor: string; acreedor: string; currency: CurrencyCode; monto: number };

export type TotalesDeUsuario = { currency: CurrencyCode; owedToYou: number; youOwe: number };

/**
 * Reparte las partes de un gasto entre quienes lo pagaron, en enteros, con los
 * dos márgenes EXACTOS: lo que debe cada participante suma su parte, y lo que
 * se le debe a cada pagador suma lo que puso. Primero el piso proporcional, y
 * los centavos que sobran se asignan en orden (determinístico, igual en todos
 * los teléfonos).
 */
function repartirEntrePagadores(
  partes: { userId: string; monto: number }[],
  pagadores: { userId: string; monto: number }[],
): number[][] {
  const total = pagadores.reduce((s, p) => s + p.monto, 0);
  const m = partes.map(() => pagadores.map(() => 0));
  if (total <= 0) return m;

  partes.forEach((s, i) => pagadores.forEach((p, j) => {
    m[i][j] = Math.floor((s.monto * p.monto) / total);
  }));
  const restoFila = partes.map((s, i) => s.monto - m[i].reduce((a, b) => a + b, 0));
  const restoCol = pagadores.map((p, j) => p.monto - m.reduce((a, fila) => a + fila[j], 0));
  for (let i = 0; i < partes.length; i++) {
    for (let j = 0; j < pagadores.length && restoFila[i] > 0; j++) {
      const x = Math.min(restoFila[i], restoCol[j]);
      if (x <= 0) continue;
      m[i][j] += x; restoFila[i] -= x; restoCol[j] -= x;
    }
  }
  return m;
}

export function deudasDelGrupo(expenses: Expense[], payments: Payment[], memberIds: string[]): DeudaPar[] {
  const roster = new Set(rosterCanonico(memberIds));
  const deudas = new Map<string, DeudaPar>();
  const clave = (a: string, b: string, c: CurrencyCode) => `${a}|${b}|${c}`;
  const sumar = (deudor: string, acreedor: string, currency: CurrencyCode, monto: number) => {
    if (monto === 0 || deudor === acreedor || !roster.has(deudor) || !roster.has(acreedor)) return;
    const k = clave(deudor, acreedor, currency);
    const d = deudas.get(k) ?? { deudor, acreedor, currency, monto: 0 };
    d.monto += monto;
    deudas.set(k, d);
  };

  for (const e of expenses) {
    if (e.isDeleted) continue;
    const partes = e.splits.map(s => ({ userId: idCanonico(s.userId), monto: s.amount }));
    const pagadores = expensePayers(e).map(p => ({ userId: idCanonico(p.userId), monto: p.amount }));
    const m = repartirEntrePagadores(partes, pagadores);
    partes.forEach((s, i) => pagadores.forEach((p, j) => sumar(s.userId, p.userId, e.currency, m[i][j])));
  }

  for (const p of payments) {
    if (p.isDeleted) continue;
    const currency = p.targetCurrency ?? p.currency;
    const monto = p.targetCurrency && p.exchangeRate
      ? convertMinorAmount(p.amount, p.currency, currency, p.exchangeRate)
      : p.amount;
    const from = idCanonico(p.fromUserId);
    const to = idCanonico(p.toUserId);
    if (from === to || !roster.has(from) || !roster.has(to)) continue;
    // El pago baja lo que `from` le debe a `to`. Si se pasara (la app no lo
    // permite), el excedente queda como deuda de `to` con `from`: así el neto
    // de cada uno sigue siendo el de siempre.
    const k = clave(from, to, currency);
    const debe = deudas.get(k)?.monto ?? 0;
    const baja = Math.min(debe, monto);
    if (baja > 0) deudas.get(k)!.monto -= baja;
    sumar(to, from, currency, monto - baja);
  }

  return [...deudas.values()].filter(d => d.monto > 0);
}

/** Cuánto le debe `deudor` a `acreedor` en esa moneda (0 si nada). */
export function deudaEntre(deudas: DeudaPar[], deudor: string, acreedor: string, currency: CurrencyCode): number {
  const a = idCanonico(deudor);
  const b = idCanonico(acreedor);
  return deudas.find(d => d.deudor === a && d.acreedor === b && d.currency === currency)?.monto ?? 0;
}

/** Te deben / Debés de una persona, por moneda, sin compensar. Sólo monedas con algo. */
export function totalesDeUsuario(deudas: DeudaPar[], userId: string): TotalesDeUsuario[] {
  const yo = idCanonico(userId);
  const porMoneda = new Map<CurrencyCode, TotalesDeUsuario>();
  const entrada = (c: CurrencyCode) => {
    let t = porMoneda.get(c);
    if (!t) { t = { currency: c, owedToYou: 0, youOwe: 0 }; porMoneda.set(c, t); }
    return t;
  };
  for (const d of deudas) {
    if (d.acreedor === yo) entrada(d.currency).owedToYou += d.monto;
    else if (d.deudor === yo) entrada(d.currency).youOwe += d.monto;
  }
  return [...porMoneda.values()];
}
