/**
 * Dibujos de las categorías en retícula de 24 (T-293). `b` es la forma principal
 * (lleva relleno), `d` los detalles (sólo trazo). Constantes de módulo: no se
 * recrean por render, así no pesan en listas largas.
 */
export type DibujoCategoria = { b: string; d: string };

export const DIBUJOS_CATEGORIA = {
  food: {
    b: 'M3.5 11h17a8.5 7.5 0 0 1-17 0z',
    d: 'M9 3.5c-1 1.2 1 2.3 0 3.5M12.5 3.5c-1 1.2 1 2.3 0 3.5M16 3.5c-1 1.2 1 2.3 0 3.5M9 21h6',
  },
  transport: {
    b: 'M4 16v-4.2l1.8-4.6A2 2 0 0 1 7.7 6h8.6a2 2 0 0 1 1.9 1.2l1.8 4.6V16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z',
    d: 'M6.5 17v2.5M17.5 17v2.5M5.5 11.5h13M7.8 14.2h.01M16.2 14.2h.01',
  },
  accommodation: {
    b: 'M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z',
    d: 'M10 20v-5h4v5',
  },
  entertainment: {
    b: 'M3.5 7.5a1 1 0 0 1 1-1h15a1 1 0 0 1 1 1V10a2 2 0 0 0 0 4v2.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V14a2 2 0 0 0 0-4z',
    d: 'M14.5 7.5v1.2M14.5 11.4v1.2M14.5 15.3v1.2',
  },
  utilities: { b: 'M13 3 5.5 13.5H11l-1 7.5 7.5-10.5H12z', d: '' },
  taxes: {
    b: 'M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z',
    d: 'M9.5 14.5l5-5M9.8 9.8h.01M14.2 14.2h.01',
  },
  health: {
    b: 'M12 20s-7.5-4.5-7.5-10A4.2 4.2 0 0 1 12 7.5 4.2 4.2 0 0 1 19.5 10c0 5.5-7.5 10-7.5 10z',
    d: 'M7.2 12.3h2.3l1.3-2.4 2 4.4 1.3-2h2.7',
  },
  shopping: {
    b: 'M5 8.5h14l-1 11a1 1 0 0 1-1 .9H7a1 1 0 0 1-1-.9z',
    d: 'M9 11V7a3 3 0 0 1 6 0v4',
  },
  other: {
    b: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z',
    d: 'M8.2 12h.01M12 12h.01M15.8 12h.01',
  },
  // Ingreso: área bajo una tendencia que sube, con flecha.
  income: {
    b: 'M4 19.5V15l5.5-5.5 3.5 3.5 7-7v13.5z',
    d: 'M4 15l5.5-5.5 3.5 3.5 7-7M15 6h5v5',
  },
} as const satisfies Record<string, DibujoCategoria>;

export type IdIconoCategoria = keyof typeof DIBUJOS_CATEGORIA;

/** Cualquier id que no tenga dibujo propio (p. ej. categorías de ingreso personal) cae a «other». */
export function idIconoCategoria(id: string): IdIconoCategoria {
  return Object.prototype.hasOwnProperty.call(DIBUJOS_CATEGORIA, id) ? (id as IdIconoCategoria) : 'other';
}
