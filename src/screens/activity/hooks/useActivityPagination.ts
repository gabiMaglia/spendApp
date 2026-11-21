import { useState } from 'react';

export const TAMANO_PAGINA = 30;

/** Corta la lista a `limite` ítems y cuenta lo que queda afuera. */
export function paginar<T>(items: T[], limite: number) {
  return { visibles: items.slice(0, limite), restantes: Math.max(0, items.length - limite) };
}

/**
 * Pagina el feed YA filtrado/buscado (así la búsqueda mira todo el historial).
 * `resetKey` cambia con filtro o búsqueda y vuelve el límite a 30; se deriva en
 * render en vez de un effect para no pintar un frame con el límite viejo.
 */
export function useActivityPagination<T>(items: T[], resetKey: string) {
  const [estado, setEstado] = useState({ limite: TAMANO_PAGINA, clave: resetKey });
  const limite = estado.clave === resetKey ? estado.limite : TAMANO_PAGINA;

  const verMas = () => setEstado({ limite: limite + TAMANO_PAGINA, clave: resetKey });
  return { ...paginar(items, limite), verMas };
}
