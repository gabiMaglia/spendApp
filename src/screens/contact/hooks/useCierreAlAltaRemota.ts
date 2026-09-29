import { useEffect, useRef } from 'react';

import { useContacts } from '@/src/screens/friends/hooks/useContacts';
import { volverAContactos } from '@/src/screens/contact/volverAContactos';

export type ModoAgregarContacto = 'my_qr' | 'scan';

/**
 * **T-197**: quien MUESTRA el QR no se enteraba de nada — la tarjeta del otro
 * llega por el buzón de contactos (`contactChannel.ts` → `addOrUpdateUser`,
 * vía `useUserStore`) y esta pantalla se quedaba mirando el código sin
 * reaccionar. Un id de contacto que no estaba en el baseline (ver abajo) es
 * el alta del otro lado — cierra sola, una sola vez, y sólo mientras se
 * muestra el QR (`mode === 'scan'` ya cierra por su cuenta en
 * `persistirContacto`).
 *
 * **Defecto #1 (hallazgo QA):** el baseline NO se captura una sola vez al
 * montar — se recaptura cada vez que se ENTRA a `my_qr` (y se limpia al
 * salir). Si no, abrir en `mode=scan` (deep link «Validar miembro»),
 * recibir por sync un alta cualquiera mientras se escanea (el guard de abajo
 * no reacciona: `mode !== 'my_qr'`, bien) y recién DESPUÉS pasar a «Mi QR»
 * comparaba contra un baseline viejo — esa alta, ya vista antes de entrar a
 * `my_qr`, se leía como "nueva" y cerraba la pantalla sin que nada hubiera
 * pasado en «Mi QR».
 *
 * Devuelve `cerradoPorAltaRef` para que el alta LOCAL lo marque y el watcher no
 * vuelva a cerrar por el mismo contacto.
 */
export function useCierreAlAltaRemota(mode: ModoAgregarContacto) {
  const contactosAlMostrarQR = useContacts();
  const idsBaseRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    idsBaseRef.current = mode === 'my_qr' ? new Set(contactosAlMostrarQR.map(u => u.id)) : null;
    // Sólo al ENTRAR/SALIR de `my_qr`: el baseline se fija una vez por
    // "estadía" en el tab, no en cada alta — si dependiera también de
    // `contactosAlMostrarQR` se recapturaría en cada alta y el watcher de
    // abajo nunca vería una diferencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  const cerradoPorAltaRef = useRef(false);
  useEffect(() => {
    if (mode !== 'my_qr' || cerradoPorAltaRef.current || idsBaseRef.current === null) return;
    const huboAlta = contactosAlMostrarQR.some(u => !idsBaseRef.current!.has(u.id));
    if (huboAlta) {
      cerradoPorAltaRef.current = true;
      volverAContactos();
    }
  }, [mode, contactosAlMostrarQR]);
  return cerradoPorAltaRef;
}
