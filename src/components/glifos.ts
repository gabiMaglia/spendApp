import type { DibujoCategoria } from '@/src/components/iconosCategoria';

/**
 * Glifos propios de la barra de pestañas, los sellos de Actividad y los filtros (T-294).
 * Mismo idioma que las categorías: retícula de 24, `b` = forma que lleva relleno en
 * dos tonos, `d` = detalles de sólo trazo.
 */
export const GLIFOS = {
  personal: { b: 'M4 8h15a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2z', d: 'M4 8.5 15.5 5v3M16 13.5h.01' },
  grupos: {
    b: 'M5 4.5h5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5zM14 13.5h5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5h-5a.5.5 0 0 1-.5-.5v-5a.5.5 0 0 1 .5-.5z',
    d: 'M16.5 4.5v6M13.5 7.5h6M4.5 16.5h6',
  },
  amigos: {
    b: 'M9 11.5a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM3.5 19.5a5.5 5.5 0 0 1 11 0z',
    d: 'M15.5 5.3a3 3 0 0 1 0 5.6M17.2 14a5 5 0 0 1 3.3 5.5',
  },
  actividad: {
    b: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
    d: 'M7 12.5h2.5l1.5-3 2.5 6 1.5-3H17',
  },
  // Filtro «todos»: cuatro casillas, sólo trazo.
  todos: { b: '', d: 'M6 6h4v4H6zM14 6h4v4h-4zM6 14h4v4H6zM14 14h4v4h-4z' },
  // Sellos de acción
  mas: { b: '', d: 'M12 6v12M6 12h12' },
  tacho: {
    b: 'M6.5 7.5h11l-.8 11.6a1 1 0 0 1-1 .9H8.3a1 1 0 0 1-1-.9z',
    d: 'M4.5 7.5h15M10 4.5h4M10.5 11v5.5M13.5 11v5.5',
  },
  deshacer: { b: '', d: 'M9 7 5 11l4 4M5 11h9a4.5 4.5 0 0 1 0 9h-2' },
} as const satisfies Record<string, DibujoCategoria>;

export type IdGlifo = keyof typeof GLIFOS;
export const IDS_GLIFO = Object.keys(GLIFOS) as IdGlifo[];
