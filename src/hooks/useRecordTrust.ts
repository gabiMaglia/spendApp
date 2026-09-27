import { useCallback, useEffect, useRef, useState } from 'react';
import { checkRecord } from '@/src/sync/trustCheck';
import { useRecurringStore } from '@/src/store/recurringStore';
import { canonicalCore } from '@/src/sync/recordCore';
import { trustOf, type TrustState } from '@/src/algorithms/recordTrust';
import type { CoreKind, CoreRecord } from '@/src/sync/recordCore';
import type { RecordVerdict } from '@/src/sync/recordHealth';

/**
 * **Verificar sólo lo que el usuario está mirando** (T-041 · S10, decisión D8).
 *
 * El número que manda es medido, no estimado: **37,57 ms por verificación en el
 * teléfono del PO** (banco de 20 en `/debug/identity`) — 9,6× la laptop del
 * §C.9 y 56× el «674 µs on Apple M4» del README de `@noble/curves`. Con eso
 * sobre la mesa, verificar el sobre entero al recibirlo quedó descartado (a 500
 * registros el drenado siguiente llega antes de que termine el anterior) y la
 * marca pasó a calcularse por fila.
 *
 * De los 37 ms salen las cuatro reglas de este hook, y ninguna es de gusto:
 *
 *  1. **Nada de curva en el render ni en el commit.** 20 filas visibles son
 *     0,75 s de hilo bloqueado; el usuario lo vería como la pantalla que no
 *     abre. Todo pasa después, en la cola.
 *  2. **De a una, cediendo el hilo entre cada una.** Un lote que las hiciera
 *     todas juntas en el primer tick cumpliría la regla 1 y bloquearía igual.
 *  3. **Cancelable.** Lo que salió de pantalla se abandona: al desmontar, o al
 *     cambiar el conjunto visible, la cola muere y lo que faltaba no se paga.
 *  4. **Una firma verificada no se vuelve a verificar nunca** en ese
 *     dispositivo. La caché de veredictos (S3) dejó de ser una optimización y
 *     pasó a ser la estructura.
 *
 * **Lo que NO hace, a propósito: medir.** La medición de S6 cuenta una vez por
 * revisión de núcleo, al mergear. Si mirar una pantalla moviera los contadores,
 * el único número que gobierna el futuro del ticket pasaría a depender de
 * cuánto scrolleó el PO.
 *
 * **Y lo que no puede prometer:** que en el teléfono no se note. Cada paso de
 * la cola es un tick de hasta 37 ms de hilo JS. El scroll es nativo y no
 * depende de esto, pero una animación en JS sí. Lo que está probado es que
 * ninguna verificación ocurre en el render, que la cola se abandona, y que las
 * firmas ya vistas no vuelven a costar. Si el PO reporta tirones, la palanca
 * disponible —y no aplicada por no poder medirla acá— es esperar a que las
 * interacciones terminen antes de arrancar la cola.
 */

/** Un trabajo de la cola: qué identifica a la firma y cómo se verifica. */
type Trabajo = { firma: string; verificar: () => RecordVerdict };

/**
 * El motor: recorre la cola de a uno por tick y va publicando veredictos.
 *
 * La clave de todo es **`firma`**, no el id del registro. Un núcleo editado
 * cambia de firma, así que su veredicto viejo deja de encontrarse y la fila
 * vuelve a `pendiente` hasta que la cola la revise: nunca se muestra un visto
 * bueno heredado de un contenido que ya no es el que está en pantalla.
 */
function useVeredictos(trabajos: readonly Trabajo[]): Readonly<Record<string, RecordVerdict>> {
  const [veredictos, setVeredictos] = useState<Record<string, RecordVerdict>>({});

  /**
   * Lo ya resuelto, entre efectos. Va en un ref y no en el estado porque es lo
   * que hace que volver a montar la cola tras un scroll no re-recorra lo que ya
   * está hecho — y porque leerlo desde el efecto no puede reiniciar el efecto.
   */
  const hechos = useRef(new Set<string>());

  // La identidad del conjunto visible. Un array nuevo en cada render reiniciaría
  // la cola sin parar; esto la reinicia sólo cuando cambia lo que hay que mirar.
  const clave = trabajos.map(t => t.firma).join('|');

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const pendientes = trabajos.filter(t => !hechos.current.has(t.firma));
    let i = 0;

    /**
     * **Un `setVeredictos` por lote, no por firma** (T-153). Con ~300 filas
     * por visita a Actividad, publicar cada veredicto apenas sale de la cola
     * es un re-render de la pantalla entera por firma. Los veredictos se
     * juntan acá y se vuelcan al estado comprometido cada ≥100 ms de reloj
     * real o cuando la cola termina — nunca antes, y nunca los dos juntos.
     *
     * Es un objeto de closure, no un ref: vive y muere con ESTE efecto, así
     * que un desmontaje a mitad de cola lo descarta solo, sin acción extra.
     */
    let buffer: Record<string, RecordVerdict> = {};
    let ultimoVolcado = Date.now();

    const volcar = () => {
      if (Object.keys(buffer).length === 0) return;
      const lote = buffer;
      buffer = {};
      ultimoVolcado = Date.now();
      setVeredictos(previos => ({ ...previos, ...lote }));
    };

    const paso = () => {
      const trabajo = pendientes[i++];
      if (!trabajo) { volcar(); return; }

      hechos.current.add(trabajo.firma);
      buffer[trabajo.firma] = trabajo.verificar();
      if (Date.now() - ultimoVolcado >= 100) volcar();

      timer = setTimeout(paso, 0);
    };

    // El primer paso también difiere: si arrancara acá, la curva caería en el
    // commit del render, que es exactamente lo que D8 prohíbe.
    timer = setTimeout(paso, 0);

    /**
     * Cortar el temporizador alcanza para que la cola no siga trabajando.
     * Acá hubo además una bandera `cancelado` que `paso()` consultaba, y era
     * **inalcanzable**: JS es de un solo hilo, así que un `paso` ya empezado
     * no se puede interrumpir a la mitad, y el que todavía no arrancó lo mata
     * el `clearTimeout`. Ninguna mutación podía tumbarla porque no había forma
     * de que valiera `true` en un momento observable — o sea, código que nadie
     * podía verificar. Se borró.
     *
     * **Pero el buffer sin volcar SÍ hay que rescatarlo** (rechazo del
     * verifier, B1). Esta limpieza corre en DOS casos y hay que acertar los
     * dos: cuando `clave` cambia (llegó/salió un registro — el drenaje normal
     * de Actividad cada 20 s) y cuando el componente se desmonta de verdad.
     * `hechos` ya marcó estas firmas como hechas ANTES de que `paso()` las
     * metiera en el buffer (para no volver a encolarlas si la lista se repite
     * sin ceder el hilo entre medio), así que si esta limpieza tirara el
     * buffer sin volcarlo, el efecto siguiente las filtraría por `hechos` y
     * jamás las volvería a poner en cola: quedarían `pendiente` para siempre
     * pese a que la curva YA corrió. Volcar acá cubre el caso de cambio de
     * clave (el efecto nuevo arranca con el estado ya al día) y es inofensivo
     * en el de desmontaje de verdad: React ignora el `setState` de un
     * componente que ya no existe.
     */
    return () => {
      if (timer) clearTimeout(timer);
      volcar();
    };
    // `trabajos` se recrea en cada render; lo que identifica al conjunto es `clave`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  return veredictos;
}

/**
 * Qué identifica a un veredicto: **el mensaje que se verificó**, más la clave y
 * la firma con la que se lo verificó.
 *
 * No el id, y tampoco `id|rev|firma`: los dos identifican al REGISTRO, no a lo
 * que se verificó. Con cualquiera de los dos, alguien toma un núcleo que ya
 * validamos, le cambia el monto y deja `id`, `rev`, `k` y `s` intactos — misma
 * clave, hereda el visto bueno, y la fila muestra «verificado» sobre un
 * contenido que nadie firmó. Es exactamente el agujero que la caché de
 * veredictos (S3) ya había tenido que cerrar en su propia clave, un nivel más
 * abajo; acá lo cerró el test de la edición, con el vector armado.
 *
 * Es la misma pre-imagen que hashea `verdictCache`, así que el criterio de
 * identidad es uno solo en toda la cadena.
 */
function firmaDeRegistro<K extends CoreKind>(kind: K, record: CoreRecord[K]): string {
  const { k = '', s = '' } = record as { k?: string; s?: string };
  return `${canonicalCore(kind, record)}|${k}|${s}`;
}

/**
 * La marca de cada registro visible, por id.
 *
 * Los que la cola todavía no miró vuelven `pendiente`, que no dibuja nada: no
 * se acusa por no haber llegado a mirar.
 */
export function useRecordTrust<K extends CoreKind>(
  kind: K, records: readonly CoreRecord[K][],
): Readonly<Record<string, TrustState>> {
  const plantillas = useRecurringStore(st => st.recurring);
  const buscarPlantilla = useCallback(
    (templateId: string) => plantillas.find(t => t.id === templateId),
    [plantillas],
  );

  // La firma se calcula UNA vez por fila y sirve para las dos mitades: encolar
  // el trabajo y leer su resultado.
  const filas = records.map(record => ({
    id: record.id,
    firma: firmaDeRegistro(kind, record),
    // Los gastos materializados no los firmó nadie, pero heredan el veredicto
    // de su plantilla, que sí está firmada (S9 · D5). Sin este buscador
    // quedarían marcados para siempre como no atribuibles.
    verificar: () => checkRecord(kind, record, buscarPlantilla),
  }));

  const veredictos = useVeredictos(filas);

  const marcas: Record<string, TrustState> = {};
  for (const fila of filas) marcas[fila.id] = trustOf(veredictos[fila.firma]);
  return marcas;
}
