import { useCallback, type MutableRefObject } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import type { TFunction } from 'i18next';

import { hapticLight, hapticSuccess, hapticWarning } from '@/src/utils/haptics';
import type { ContactPayload } from '@/src/utils/contactLink';
import { announceContact, savePeer, hasConflictingPinnedKeys } from '@/src/sync/contactos/contactChannel';
import { deviceId } from '@/src/sync/motor/relayEngine';
import { withTimeout } from '@/src/utils/withTimeout';
import { syncedNow } from '@/src/utils/syncedClock';
import { esYo } from '@/src/store/identityAlias';
import type { User } from '@/src/types/models';
import { volverAContactos } from '@/src/screens/contact/volverAContactos';

/** Mismo valor que `ANUNCIO_TIMEOUT_MS` en `relayEngine.ts`: no colgar el cartel
 * si la red no contesta nunca (T-138-bis). */
const ANUNCIO_TIMEOUT_MS = 8_000;

export type OrigenContacto = 'qr' | 'link';

export type AltaDeContactoDeps = {
  currentUser: User | null;
  addOrUpdateUser: (user: User) => void;
  getUserById: (id: string) => User | undefined;
  t: TFunction;
  setScanned: (v: boolean) => void;
  cerradoPorAltaRef: MutableRefObject<boolean>;
};

/**
 * Lo que hacía `procesarContacto` de punta a punta ANTES de este ticket: agrega el
 * contacto, pinnea sus claves y le anuncia la propia tarjeta. Ahora sólo se llega acá
 * cuando ya no hay nada que confirmar (QR presencial) o después de que el usuario tocó
 * «Agregar» en la hoja de confirmación (link) — ver `procesarContacto`.
 *
 * **Repite los tres chequeos de sólo lectura INMEDIATAMENTE antes de escribir**
 * (T-093 ronda 2 / R-1, hallazgo del verificador ciego): en el link, `procesarContacto`
 * los corrió al ABRIR la hoja, pero el toque de «Agregar» llega recién después —a veces
 * segundos después— y en ese hueco puede pasar cualquier cosa. En particular, el drenado
 * en tiempo real (`relayEngine.ts` → `drainContacts` → `savePeerFromCard`) puede pinnear
 * la clave REAL de este mismo `userId` si su tarjeta legítima llega mientras la hoja
 * sigue abierta (no había peer previo, así que no hay conflicto para esa función). Sin
 * este recheck, el toque de «Agregar» corría directo a `savePeer`, que SÍ pisa siempre
 * que se lo llama, y las claves recién pinneadas quedaban reemplazadas por las del link.
 *
 * Al vivir acá y no en el llamador, ningún camino (QR o link, presente o futuro) puede
 * saltearlo — es la única puerta hacia `savePeer`/`announceContact`.
 */
export function usePersistirContacto({
  currentUser, addOrUpdateUser, getUserById, t, setScanned, cerradoPorAltaRef,
}: AltaDeContactoDeps) {
  return useCallback((contact: ContactPayload, origen: OrigenContacto) => {
    const cerrar = origen === 'link' ? volverAContactos : () => setScanned(false);

    if (esYo(contact.id)) {
      cerrar();
      return;
    }

    // Orden: conflicto de clave ANTES de "ya existe" (T-101, mismo criterio que
    // `procesarContacto`) — un miembro activo con clave nueva no puede quedar
    // enmascarado por "ya lo tenés". Este re-chequeo (además del de `procesarContacto`)
    // es el que cierra la carrera de T-093 ronda 2 / R-1 descripta arriba: acá nunca se
    // ofrece reemplazo (eso vive en `procesarContacto`/`confirmarReemplazoDeClave`),
    // sólo se corta antes de escribir si algo cambió en el medio.
    if (contact.secret && hasConflictingPinnedKeys(contact.id, {
      secret: contact.secret,
      wrapPublicKey: contact.wrapPublicKey,
      identityPublicKey: contact.identityPublicKey,
    })) {
      hapticWarning();
      Alert.alert(
        t('contact.keys_changed_title'),
        t('contact.keys_changed_body', { name: contact.name }),
        [{ text: 'OK', onPress: cerrar }],
      );
      return;
    }

    if (getUserById(contact.id) && !getUserById(contact.id)?.isDeleted) {
      hapticLight();
      Alert.alert(t('contact.already_title'), t('contact.already_body', { name: contact.name }), [
        { text: 'OK', onPress: volverAContactos },
      ]);
      return;
    }

    hapticSuccess();
    addOrUpdateUser({
      id:           contact.id,
      // El email no viaja más en la tarjeta/código (T-093 / SEC H-1): se conserva el que
      // ya hubiera localmente en vez de perderlo o inventar uno vacío innecesariamente.
      name:         contact.name,
      email:        getUserById(contact.id)?.email ?? '',
      authProvider: 'google',
      createdAt:    Date.now(),
      updatedAt:    syncedNow(),
      isDeleted:    false,
    });

    // Le dejo mi tarjeta en su buzón: con esto el contacto queda en LOS DOS
    // teléfonos con un solo escaneo. El alta LOCAL no espera a la red — si falla,
    // lo peor que pasa es lo que pasaba antes — pero el CARTEL sí espera el
    // resultado real (BUG «contacto por QR queda de un solo lado»,
    // engram/qa/BUG-qr-contacto.md): antes se asumía éxito mutuo con sólo mirar
    // si el código traía secreto, sin mirar si `announceContact` (el envío al
    // buzón del otro) salió bien. Con la build sin relay configurado o sin red
    // justo en ese momento, el otro aparato nunca se enteraba y el cartel decía
    // igual "quedaron conectados los dos".
    const tieneSecreto = Boolean(contact.secret);
    if (contact.secret) {
      savePeer(contact.id, {
        secret: contact.secret,
        wrapPublicKey: contact.wrapPublicKey,
        identityPublicKey: contact.identityPublicKey,
      });
    }
    /**
     * **El alta cierra la pantalla en el acto** (PO, 2026-09-12), y el cartel aparece ya
     * sobre Contactos. Antes cerraba el «OK» del cartel, y en Android tocar fuera lo
     * descarta sin llamar a `onPress`: quedabas en la cámara, con el escaneo trabado.
     * Esto no cambia con el fix: el cierre sigue sin depender de la red.
     *
     * `cerradoPorAltaRef` marcado ACÁ (T-197): este `addOrUpdateUser` de más arriba
     * es el propio alta local (QR presencial o link) — sin esto, el watcher de
     * "mostrar QR" (`useCierreAlAltaRemota`) vería el mismo contacto nuevo en el store
     * un instante después y volvería a cerrar (doble `router.back()`).
     */
    cerradoPorAltaRef.current = true;
    volverAContactos();

    const cartelUnaDireccion = () => Alert.alert(
      t('contact.added_title'),
      t('contact.added_half_body', { name: contact.name }),
      [
        { text: t('contact.later'), style: 'cancel' },
        // La pantalla ya se cerró: mostrar mi código es volver a abrirla (arranca en «mi QR»).
        { text: t('contact.show_my_code'), onPress: () => router.push('/contact/add') },
      ],
    );

    // Código viejo sin secreto: nunca fue mutuo, no hay nada que anunciar ni que esperar.
    if (!tieneSecreto) {
      cartelUnaDireccion();
      return;
    }

    /**
     * El código trae secreto (alta MUTUA en potencia): el cartel espera el resultado
     * REAL de `announceContact`, con el mismo timeout que usa el reintento automático
     * (`ANUNCIO_TIMEOUT_MS` en `relayEngine.ts`) para no dejar la promesa colgada si la
     * red no contesta nunca. Si falla —sin relay configurado, sin red en el momento del
     * QR— NO queda a medias para siempre: `anunciarMiTarjeta` (relayEngine, corre en
     * cada sync) reintenta solo, porque este código nunca marca la tarjeta como
     * enviada — eso lo hace únicamente `marcarCardEnviada`, que vive allá.
     */
    void withTimeout(announceContact(contact.secret!, deviceId()), ANUNCIO_TIMEOUT_MS, false)
      .then((anuncioOk) => {
        if (anuncioOk) {
          Alert.alert(
            t('contact.added_title'),
            t('contact.added_both_body', { name: contact.name }),
            [{ text: 'OK' }],
          );
          return;
        }
        cartelUnaDireccion();
      });
    // `currentUser` no aparece en el cuerpo pero la dependencia es REAL: `esYo` lee la
    // sesión activa, así que cambiar de cuenta tiene que recalcular esto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addOrUpdateUser, getUserById, t, currentUser, setScanned, cerradoPorAltaRef]);
}
