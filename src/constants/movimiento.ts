import { Easing } from 'react-native-reanimated';

/**
 * La personalidad de movimiento de la app (T-289): todo lo que se anima sale de acá,
 * para que se sienta una sola mano y no cada pantalla a su manera.
 */

/** «Sharp, swift and soft»: rigidez alta, amortiguación justa (ζ≈0.8, ~1 % de rebote). */
export const RESORTE_MARCA = { stiffness: 560, damping: 38, mass: 1 } as const;

/** Duraciones (ms) de lo que no es un resorte: fundidos y entradas/salidas de hojas y menús. */
export const DURACION = {
  /** Fundido con «reducir movimiento»: lo mínimo que se nota. */
  fundido: 90,
  salida: 120,
  corta: 150,
  media: 200,
  /** Números que ruedan: más tiempo, para que se lea el viaje. */
  larga: 350,
} as const;

/** Demora entre un elemento y el siguiente en entradas en cascada (cápsulas, filas de menú). */
export const ESCALONADO_MS = 24;

/** Cuánto se achica algo tocable mientras el dedo está encima. */
export const ESCALA_PRESION = 0.97;

export const CURVA = {
  entrar: Easing.out(Easing.cubic),
  salir: Easing.in(Easing.quad),
} as const;

/** 0 con «reducir movimiento»; `null` (la consulta aún no resolvió) anima, como el resto de la app. */
export function duracionSegun(ms: number, reducido: boolean | null): number {
  return reducido === true ? 0 : ms;
}
