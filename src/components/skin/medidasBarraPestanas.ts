/** Alto de la píldora de pestañas (calibrar con captura en iPhone 13; Apple no publica la medida). */
export const ALTO_PILDORA = 62;
/** Tope de la huella en iPhone con indicador de inicio (la nativa mide 83). */
export const HUELLA_MAXIMA_IOS = 86;
/** Aire mínimo con el borde cuando no hay inset. */
const PISO_AIRE = 12;
/** Aire sobre la barra de tres botones de Android. */
const AIRE_ANDROID = 8;
/** Cuánto se mete la píldora en la zona del indicador de inicio de iOS. */
const SOLAPE_INDICADOR_IOS = 12;

export type Plataforma = 'ios' | 'android';

/**
 * Distancia al borde inferior de la pantalla de la píldora Y de toda botonera
 * del pie (T-281): una sola cuenta para que queden alineadas. Quien la usa NO
 * debe sumar además el inset (p. ej. con `SafeAreaView edges=['bottom']`).
 */
export function baseInferior(insetBottom: number, plataforma: Plataforma): number {
  return plataforma === 'ios'
    ? Math.max(insetBottom - SOLAPE_INDICADOR_IOS, PISO_AIRE)
    : Math.max(insetBottom + AIRE_ANDROID, PISO_AIRE);
}

export interface MedidasBarra {
  altoPildora: number;
  radio: number;
  margenLateral: number;
  /** Distancia de la píldora al borde inferior de la pantalla. */
  bottom: number;
  /** Lo que la barra ocupa desde el borde: es el alto que reserva el contenido. */
  huella: number;
}

/**
 * Única fuente de las medidas de la barra flotante. En iOS la píldora se mete
 * en la zona del indicador (como la de iOS 26); en Android queda entera encima
 * de la barra del sistema, que es opaca y taparía los íconos.
 */
export function medidasBarraPestanas(
  { insetBottom, plataforma, margenLateral }:
  { insetBottom: number; plataforma: Plataforma; margenLateral: number },
): MedidasBarra {
  const bottom = baseInferior(insetBottom, plataforma);
  return {
    altoPildora: ALTO_PILDORA,
    radio: ALTO_PILDORA / 2,
    margenLateral,
    bottom,
    huella: bottom + ALTO_PILDORA,
  };
}
