/**
 * **Memoria de sesión de `MontoRodante`** (T-106, corrección del PO 2026-09-13).
 *
 * El diseño original animaba en cada foco de pestaña; el PO lo revirtió: un
 * monto rueda la PRIMERA vez que se muestra en la sesión de la app, y de nuevo
 * sólo si el valor CAMBIA (cambio de divisa, nuevo gasto/ingreso, post-sync).
 * Volver a una pestaña con el mismo número no anima.
 *
 * La regla completa se reduce a una sola comparación: "¿el texto que llega
 * difiere del último que vimos para este `id`?" — la primera vez, "el último"
 * es `undefined`, así que también cuenta como cambio. Por eso no hace falta
 * una bandera aparte de "primera vez": es el mismo caso que "cambió".
 *
 * Vive en MEMORIA (un `Map` de módulo), nunca en disco: un reinicio de la app
 * es una sesión nueva y todo vuelve a rodar una vez. Un remount del componente
 * con el MISMO id y el MISMO valor no debe rodar de nuevo — por eso el
 * registro es de módulo y no `useState`/`useRef` del componente: sobrevive al
 * desmontaje.
 *
 * La clave (`id`) la elige quien usa `MontoRodante` y NO es el valor: es la
 * identidad estable de esa posición en pantalla (ej. `'home.disponible'`,
 * `'groupDetail.balance:<groupId>'`). Dos montos con la misma clave se pisan
 * a propósito — son "el mismo número" a efectos de esta memoria.
 */
export type MontoRegistry = Map<string, string>;

export function crearRegistroDeMontos(): MontoRegistry {
  return new Map();
}

/**
 * ¿Corresponde animar este monto? Compara `value` contra el último valor
 * registrado para `id` y ACTUALIZA el registro con el valor actual (efecto
 * secundario intencional: la próxima llamada ya lo ve como "visto").
 */
export function debeRodar(registro: MontoRegistry, id: string, value: string): boolean {
  const anterior = registro.get(id);
  registro.set(id, value);
  return anterior !== value;
}

/** Registro único de la app — el que usa `MontoRodante` por defecto. */
export const registroDeMontosDeLaApp: MontoRegistry = crearRegistroDeMontos();
