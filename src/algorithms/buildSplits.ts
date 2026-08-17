import type { Split, SplitMode } from '@/src/types/models';

/**
 * Construye el array de splits para un gasto. Todos los montos son ENTEROS
 * en menor unidad (ADR-002) — sin floats, sin epsilon.
 *
 * Modos:
 *   'equal'      — Divide el total en partes iguales. El resto de la división
 *                   entera (0..N−1 unidades) se reparte de a 1 unidad extra
 *                   entre los primeros miembros ordenados por userId ASCENDENTE
 *                   (ADR-002 §4) — determinista e independiente del orden de
 *                   entrada, para que dos dispositivos P2P generen los mismos
 *                   splits sin importar en qué orden armaron memberIds.
 *   'percentage' — values[i] = % de cada miembro (deben sumar 100). Los montos
 *                  se redondean con Math.round; si el redondeo no cierra exacto
 *                  contra el total, el resto/déficit se corrige con el MISMO
 *                  criterio determinista por userId ascendente.
 *   'shares'     — values[i] = cantidad de partes de cada miembro (enteros > 0).
 *                  Ej: [2,1,1] reparte mitad / cuarto / cuarto. Sirve para
 *                  "yo ocupo la habitación doble y ustedes las simples" sin
 *                  tener que calcular porcentajes a mano. El resto de la
 *                  división se corrige con el MISMO criterio determinista por
 *                  userId ascendente que usan los otros modos.
 *   'custom'     — values[i] = monto de cada miembro EXCEPTO el último,
 *                  que recibe automáticamente el resto (total − suma de los demás).
 *
 * @param totalAmount  Monto total del gasto, entero en menor unidad
 * @param memberIds    IDs de los miembros en el split, en orden
 * @param mode         Modo de división
 * @param values       Para 'percentage' y 'custom': array de longitud memberIds.length − 1
 *                     (el último miembro se calcula solo en 'custom') o memberIds.length
 *                     (para 'percentage' todos deben estar).
 */
export function buildSplits(
  totalAmount: number,
  memberIds: string[],
  mode: SplitMode,
  values?: number[],
): Split[] {
  if (memberIds.length === 0) return [];

  switch (mode) {
    case 'equal': {
      const n = memberIds.length;
      const base = Math.floor(totalAmount / n);
      const remainder = totalAmount - base * n; // entero en [0, n-1]

      // Orden determinista por userId ascendente — independiente del orden
      // de memberIds recibido (ADR-002 §4).
      const sortedIds = [...memberIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const extra = new Set(sortedIds.slice(0, remainder));

      return memberIds.map(userId => ({
        userId,
        amount: base + (extra.has(userId) ? 1 : 0),
        isPaid: false,
      }));
    }

    case 'percentage': {
      if (!values || values.length !== memberIds.length) {
        throw new Error('buildSplits: percentage requiere values con un % por miembro');
      }
      const rawAmounts = values.map(pct => Math.round(totalAmount * pct / 100));
      const sum = rawAmounts.reduce((a, b) => a + b, 0);
      const diff = totalAmount - sum; // entero, puede ser + o - por acumulación de redondeo

      if (diff === 0) {
        return memberIds.map((userId, i) => ({
          userId,
          amount: rawAmounts[i]!,
          isPaid: false,
        }));
      }

      // Corrección determinista: se distribuye 1 unidad de diferencia (signo de diff)
      // por miembro, en orden de userId ascendente, hasta agotar el diff.
      const order = memberIds
        .map((userId, i) => ({ userId, i }))
        .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
      const step = diff > 0 ? 1 : -1;
      let remaining = Math.abs(diff);
      const adjusted = [...rawAmounts];
      for (const { i } of order) {
        if (remaining === 0) break;
        adjusted[i] = adjusted[i]! + step;
        remaining -= 1;
      }

      return memberIds.map((userId, i) => ({
        userId,
        amount: adjusted[i]!,
        isPaid: false,
      }));
    }

    case 'shares': {
      if (!values || values.length !== memberIds.length) {
        throw new Error('buildSplits: shares requiere values con una cantidad de partes por miembro');
      }
      if (values.some(v => !Number.isInteger(v) || v < 0)) {
        throw new Error('buildSplits: las partes deben ser enteros >= 0');
      }
      const totalShares = values.reduce((a, b) => a + b, 0);
      if (totalShares === 0) {
        throw new Error('buildSplits: la suma de partes no puede ser 0');
      }

      // Se reparte por parte entera y el resto se distribuye de a 1 unidad,
      // igual que en 'equal', para que dos devices lleguen al mismo resultado.
      const raw = values.map(sh => Math.floor(totalAmount * sh / totalShares));
      const diff = totalAmount - raw.reduce((a, b) => a + b, 0);

      const order = memberIds
        .map((userId, i) => ({ userId, i }))
        .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));

      const step = diff > 0 ? 1 : -1;
      let remaining = Math.abs(diff);
      const adjusted = [...raw];
      for (const { i } of order) {
        if (remaining === 0) break;
        if (values[i] === 0) continue; // quien no participa no absorbe el resto
        adjusted[i] = adjusted[i]! + step;
        remaining -= 1;
      }

      return memberIds.map((userId, i) => ({
        userId,
        amount: adjusted[i]!,
        isPaid: false,
      }));
    }

    case 'custom': {
      // values contiene los montos de todos los miembros excepto el último.
      // El último recibe el resto.
      const othersCount = memberIds.length - 1;
      if (!values || values.length !== othersCount) {
        throw new Error(
          `buildSplits: custom requiere values con ${othersCount} montos (todos menos el último)`,
        );
      }
      const sumOthers = values.reduce((a, b) => a + b, 0);
      const lastAmount = totalAmount - sumOthers;
      return memberIds.map((userId, i) => ({
        userId,
        amount: i < othersCount ? values[i]! : lastAmount,
        isPaid: false,
      }));
    }
  }
}

/**
 * Para 'custom': calcula el monto restante para el último miembro en tiempo real.
 * Útil para mostrarlo mientras el usuario escribe. Entero en menor unidad.
 */
export function calculateRemainder(totalAmount: number, enteredAmounts: number[]): number {
  const sum = enteredAmounts.reduce((a, b) => a + b, 0);
  return totalAmount - sum;
}

/**
 * Valida que los porcentajes de un split 'percentage' sumen 100 (con tolerancia
 * — opera sobre porcentajes, no sobre montos, así que la tolerancia float aquí
 * es intencional y no forma parte de ADR-002).
 */
export function validatePercentages(percentages: number[]): boolean {
  const sum = percentages.reduce((a, b) => a + b, 0);
  return Math.abs(sum - 100) < 0.1;
}
