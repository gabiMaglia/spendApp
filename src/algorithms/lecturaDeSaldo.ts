/**
 * **Cómo se LEE un saldo** (PO 2026-11-06, opción A): el número grande es el
 * neto (te deben − debés) y los dos brutos quedan como desglose chico.
 *
 * Sólo cambia la lectura. La deuda sigue siendo por par y sin compensar
 * (T-225): Saldar paga lo tuyo completo y no descuenta lo que te deben.
 *
 * El desglose se muestra sólo cuando hay deuda de los dos lados: con un solo
 * lado, el bruto ES el neto y repetirlo no aporta nada.
 */
export type TonoDeSaldo = 'favor' | 'contra' | 'saldado';

export type LecturaDeSaldo = {
  tono: TonoDeSaldo;
  /** Valor absoluto del neto, en unidades menores. El signo lo dice `tono`. */
  neto: number;
  desglose: boolean;
};

const limpio = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

export function lecturaDeSaldo(owedToYou: number, youOwe: number): LecturaDeSaldo {
  const aFavor = limpio(owedToYou);
  const enContra = limpio(youOwe);
  const diferencia = aFavor - enContra;
  return {
    tono: diferencia > 0 ? 'favor' : diferencia < 0 ? 'contra' : 'saldado',
    neto: Math.abs(diferencia),
    desglose: aFavor > 0 && enContra > 0,
  };
}
