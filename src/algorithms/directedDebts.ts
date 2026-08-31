import type { CurrencyCode } from '@/src/constants/currencies';

/**
 * Deuda DIRECCIONAL entre el usuario y otra persona (ADR-006, decisión 1).
 *
 * Lo que le debo y lo que me debe son **dos hechos distintos**, no dos signos
 * de un mismo número. Compensarlos automáticamente decide por los dos que
 * están de acuerdo en cancelarse — y puede que uno haya pagado y el otro no.
 *
 * De acá salió un bug real: en un grupo el PO le debía 5.000 a alguien y en
 * otro esa persona le debía 5.000. El modelo decía "cero", y saldar volcó un
 * neto global dentro de un solo grupo, dejando los dos con saldos que nadie
 * había generado.
 */
export type DirectedDebt = {
  userId: string;
  currency: CurrencyCode;
  /** Lo que esa persona me debe. Siempre ≥ 0. */
  owesMe: number;
  /** Lo que yo le debo. Siempre ≥ 0. */
  iOwe: number;
};

export type Transferencia = {
  fromUserId: string;
  toUserId: string;
  amount: number;
  currency: CurrencyCode;
};

/**
 * Agrupa transferencias en deudas direccionales.
 *
 * IMPORTANTE: las transferencias tienen que venir simplificadas **por grupo**,
 * no de un pozo con todos los grupos juntos. Simplificar el pozo entero es
 * exactamente lo que netea entre grupos, que es lo que este modelo evita.
 */
export function directedDebts(transferencias: Transferencia[], me: string): DirectedDebt[] {
  const porClave = new Map<string, DirectedDebt>();

  const entrada = (userId: string, currency: CurrencyCode): DirectedDebt => {
    const clave = `${userId}:${currency}`;
    let d = porClave.get(clave);
    if (!d) { d = { userId, currency, owesMe: 0, iOwe: 0 }; porClave.set(clave, d); }
    return d;
  };

  for (const t of transferencias) {
    if (t.fromUserId === me) entrada(t.toUserId, t.currency).iOwe += t.amount;
    else if (t.toUserId === me) entrada(t.fromUserId, t.currency).owesMe += t.amount;
    // Una transferencia entre otras dos personas no es asunto mío.
  }

  return [...porClave.values()];
}

/**
 * El neto, para resumir de un vistazo si estás a favor o en contra.
 *
 * Sigue existiendo — lo que dejó de ser es la DEFINICIÓN de la deuda. Sirve
 * para mostrar, nunca para decidir cuánto se puede saldar.
 */
export function netOf(d: DirectedDebt): number {
  return d.owesMe - d.iOwe;
}

/** Cuánto debo en total en una moneda. No se compensa con lo que me deben. */
export function totalIOwe(deudas: DirectedDebt[], currency: CurrencyCode): number {
  return deudas.reduce((s, d) => s + (d.currency === currency ? d.iOwe : 0), 0);
}

/** Cuánto me deben en total en una moneda. No se compensa con lo que debo. */
export function totalOwedToMe(deudas: DirectedDebt[], currency: CurrencyCode): number {
  return deudas.reduce((s, d) => s + (d.currency === currency ? d.owesMe : 0), 0);
}
