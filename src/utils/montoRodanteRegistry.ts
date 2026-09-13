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

/**
 * **Semilla de la primera aparición** (T-106, pedido del PO 2026-09-13: «si
 * el valor es 0, igual tiene que girar»).
 *
 * `number-flow-react-native` anima por DIFERENCIA entre el valor anterior y
 * el nuevo: si se monta directo en el valor real, no hay transición que
 * animar (monta y ya) — se probó, la librería no expone un modo "vueltas
 * forzadas al montar" (revisado su `README` y sus tipos: `continuous` sólo
 * hace girar dígitos que NO cambiaron cuando otro de mayor orden SÍ cambió;
 * con 0→0 ningún dígito cambia y no dispara nada).
 *
 * La salida: montar con esta semilla y, al frame siguiente, pasar al valor
 * real — la librería ve un cambio genuino en CADA dígito (nunca en cero) y
 * anima las columnas. Cada dígito de la semilla es el opuesto en la rueda
 * (`+5 mod 10`) del dígito real en esa misma posición decimal: garantiza que
 * TODOS difieren (por eso "todas las columnas giran", no sólo la que cambiaría
 * en un update común) y, al ser diametralmente opuesto, es la vuelta más
 * larga que una única transición de la librería puede expresar — media
 * vuelta, no "varias vueltas completas": la librería no tiene un primitivo de
 * multi-vuelta por dígito. Limitación conocida, documentada acá y en el
 * handoff.
 *
 * Trabaja sobre la representación decimal CANÓNICA de JS (`Math.abs(x).toString()`,
 * siempre con `.` sin importar el locale de salida) y no sobre el texto ya
 * formateado con `Intl` — mantiene la MISMA cantidad de dígitos que el valor
 * real así el ancho no salta al pasar de semilla a real.
 */
export function numeroSemilla(valorReal: number): number {
  const texto = Math.abs(valorReal).toString();
  const transformado = texto.replace(/[0-9]/g, (d) => String((Number(d) + 5) % 10));
  const n = Number(transformado);
  return Number.isFinite(n) ? n : valorReal;
}
