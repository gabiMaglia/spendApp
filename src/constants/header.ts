/** Medidas del header único de las pestañas (T-114, T-125, T-126, T-128). */

/** Alto de la fila de botones, sin el notch. */
export const HEADER_BAR_H = 52;

/**
 * Alto total del header (fila de botones + bloque título) que vio el PO en el teléfono
 * tras T-114: 52 + 33 = 85pt, sin el notch. Base del pedido de T-125.
 */
export const HEADER_TOTAL_H_T114 = 85;

/** «El doble y un poco más» (PO 2026-09-13, T-125): ×2,2 sobre el header de T-114. */
export const FACTOR_ALTO_HEADER = 2.2;

/**
 * **Alto del bloque título** (T-114 → T-125): lo que queda del alto total pedido después
 * de la fila de botones. La fila de botones no cambia; crece el espacio del título, que
 * va abajo con `space-between`. Es un piso: en Inicio el saludo suma una línea.
 */
/** Distancia máxima del título al borde inferior del header (PO, T-126). */
export const TITLE_BOTTOM_GAP = 6;

export const TITLE_BLOCK_H = Math.round(HEADER_TOTAL_H_T114 * FACTOR_ALTO_HEADER) - HEADER_BAR_H;
