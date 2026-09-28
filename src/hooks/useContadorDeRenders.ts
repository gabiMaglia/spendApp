import { useRef } from 'react';
import { activo, registrarRender } from '@/src/dev/contadorDeRenders';

/**
 * T-215: instrumenta un componente para el contador de re-renders (DEV-ONLY).
 *
 * Cuenta en el CUERPO del render (no en un `useEffect`): un `useEffect`
 * cuenta EFECTOS, no renders — con `StrictMode`/doble-invocación o un efecto
 * que se salta por deps sin cambios, el número dejaría de ser "cuántas veces
 * pintó esto en pantalla", que es la pregunta que el PO quiere responder.
 *
 * `deps` es opcional: un objeto `{ nombre: valor }` con lo que el componente
 * ya tiene en scope (props de un store, ids, lo que sea). El motivo que se
 * reporta es la clave cuyo valor cambió por `Object.is` respecto del render
 * anterior — así el log dice QUÉ cambió, no sólo que algo cambió. En el
 * primer render no hay "anterior" con qué comparar, así que no se reporta
 * ningún motivo (el render igual se cuenta).
 */
export function useContadorDeRenders(nombre: string, deps?: Record<string, unknown>): void {
  const anteriorRef = useRef<Record<string, unknown> | undefined>(undefined);

  // Con el flag apagado no tiene sentido acumular (nadie va a leerlo, y el
  // `anteriorRef` de un componente que rara vez re-renderiza podría quedar
  // viejo por horas) — se re-arranca la comparación limpia si se prende
  // después.
  if (!__DEV__ || !activo()) { anteriorRef.current = undefined; return; }

  const anterior = anteriorRef.current;
  let motivo: string | undefined;

  if (deps && anterior) {
    const cambiadas = Object.keys(deps).filter(k => !Object.is(deps[k], anterior[k]));
    // Si cambiaron varias a la vez, van juntas en un solo motivo (una clave
    // compuesta) — es UN render, no uno por dep.
    motivo = cambiadas.length > 0 ? cambiadas.join(',') : undefined;
  }

  registrarRender(nombre, motivo);
  anteriorRef.current = deps;
}
