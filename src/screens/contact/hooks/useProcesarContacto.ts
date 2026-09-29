import { useCallback, type MutableRefObject } from 'react';
import { Alert } from 'react-native';

import { hapticLight, hapticSuccess, hapticWarning } from '@/src/utils/haptics';
import type { ContactPayload } from '@/src/utils/contactLink';
import { announceContact, savePeer, hasConflictingPinnedKeys } from '@/src/sync/contactos/contactChannel';
import { deviceId } from '@/src/sync/motor/relayEngine';
import { syncedNow } from '@/src/utils/syncedClock';
import { esYo } from '@/src/store/identityAlias';
import { volverAContactos } from '@/src/screens/contact/volverAContactos';
import type { AltaDeContactoDeps, OrigenContacto } from '@/src/screens/contact/hooks/usePersistirContacto';

type Deps = Omit<AltaDeContactoDeps, 'cerradoPorAltaRef'> & {
  persistirContacto: (contact: ContactPayload, origen: OrigenContacto) => void;
  pendingLinkContact: ContactPayload | null;
  setPendingLinkContact: (c: ContactPayload | null) => void;
  confirmedRef: MutableRefObject<boolean>;
};

/**
 * Decide qué hacer con un contacto entrante (QR o link) y maneja la hoja de
 * confirmación del link. Nada acá persiste por su cuenta salvo el reemplazo de
 * clave de T-101: el alta normal pasa siempre por `persistirContacto`.
 */
export function useProcesarContacto({
  currentUser, addOrUpdateUser, getUserById, t, setScanned,
  persistirContacto, pendingLinkContact, setPendingLinkContact, confirmedRef,
}: Deps) {
  /**
   * **T-101**: reemplaza la clave pinneada de un contacto que ya conocíamos —
   * típicamente porque reinstaló la app. Sólo se llega acá desde el camino QR
   * (el escaneo presencial es la verificación, T-093 criterio 4), y sólo tras
   * la doble confirmación explícita del `Alert` de conflicto.
   *
   * No hace falta reenviar la clave de ningún grupo a mano: `reenviarClavesDeGrupo`
   * (`relayEngine.ts`) ya corre sola en cada arranque/sync y le reintenta la entrega
   * a cualquier contacto conocido — apenas el peer quede pinneado de nuevo, el
   * reparto (y con ADR-007, el estado completo del grupo) le llega solo.
   */
  const reemplazarClaveDeContacto = useCallback((contact: ContactPayload) => {
    if (!contact.secret) return;

    savePeer(contact.id, {
      secret: contact.secret,
      wrapPublicKey: contact.wrapPublicKey,
      identityPublicKey: contact.identityPublicKey,
    });
    addOrUpdateUser({
      id:           contact.id,
      name:         contact.name,
      email:        getUserById(contact.id)?.email ?? '',
      authProvider: 'google',
      createdAt:    getUserById(contact.id)?.createdAt ?? Date.now(),
      updatedAt:    syncedNow(),
      isDeleted:    false,
    });
    void announceContact(contact.secret, deviceId());

    hapticSuccess();
    setScanned(false);
    Alert.alert(t('contact.replaced_title'), t('contact.replaced_body', { name: contact.name }), [{ text: 'OK' }]);
  }, [addOrUpdateUser, getUserById, t, setScanned]);

  /** Segunda confirmación explícita antes de pisar una clave pinneada (T-101). */
  const confirmarReemplazoDeClave = useCallback((contact: ContactPayload) => {
    Alert.alert(
      t('contact.keys_changed_confirm_title'),
      t('contact.keys_changed_confirm_body', { name: contact.name }),
      [
        { text: t('common.cancel'), style: 'cancel', onPress: () => setScanned(false) },
        { text: t('contact.keys_changed_replace'), style: 'destructive', onPress: () => reemplazarClaveDeContacto(contact) },
      ],
    );
  }, [t, reemplazarClaveDeContacto, setScanned]);

  /**
   * Evalúa un contacto que llegó por QR o por link. **Los dos caminos pasan por acá**:
   * antes el link se procesaba aparte, en `_layout.tsx`, agregaba en silencio y dejaba
   * al usuario mirando SU PROPIO QR, sin ningún aviso de que el contacto había entrado.
   *
   * De acá en más NO escribe nada por su cuenta: sólo decide entre "no hay nada que
   * hacer" (ya es mío / ya existe / las claves no coinciden), "persistir ya" (QR — el
   * escaneo presencial YA es el consentimiento, T-093 criterio 4) o "pedir confirmación"
   * (link — nadie estuvo delante, T-093 / SEC H-1 criterio 1).
   *
   * **El chequeo de clave-en-conflicto va ANTES del de "ya existe"** (T-101): un
   * contacto que ya es miembro ACTIVO de un grupo (no borrado) con una clave nueva
   * tiene que llegar al aviso de conflicto, no quedarse trabado en "ya lo tenés".
   */
  const procesarContacto = useCallback((contact: ContactPayload, origen: OrigenContacto) => {
    if (esYo(contact.id)) {
      hapticWarning();
      Alert.alert(
        t('contact.own_qr_title'),
        t(origen === 'link' ? 'contact.own_link_body' : 'contact.own_qr_body'),
        [{ text: 'OK', onPress: () => (origen === 'link' ? volverAContactos() : setScanned(false)) }],
      );
      return;
    }

    // Ni por link ni por QR se pisa una clave ya pinneada que no coincide sin pedir
    // confirmación — ni la de un contacto borrado (tombstone): el peer sobrevive al
    // borrado (T-093 / SEC H-1 criterio 2). Por QR, T-101 agrega una salida explícita
    // ("Reemplazar clave" + segunda confirmación); por link se mantiene sin salida.
    if (contact.secret && hasConflictingPinnedKeys(contact.id, {
      secret: contact.secret,
      wrapPublicKey: contact.wrapPublicKey,
      identityPublicKey: contact.identityPublicKey,
    })) {
      hapticWarning();
      if (origen === 'link') {
        Alert.alert(
          t('contact.keys_changed_title'),
          t('contact.keys_changed_body', { name: contact.name }),
          [{ text: 'OK', onPress: volverAContactos }],
        );
        return;
      }
      Alert.alert(
        t('contact.keys_changed_title'),
        t('contact.keys_changed_body_qr', { name: contact.name }),
        [
          { text: t('common.cancel'), style: 'cancel', onPress: () => setScanned(false) },
          { text: t('contact.keys_changed_replace'), style: 'destructive', onPress: () => confirmarReemplazoDeClave(contact) },
        ],
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

    if (origen === 'link') {
      // Nada se persiste todavía: recién con el toque explícito de "Agregar" en la hoja.
      setPendingLinkContact(contact);
      return;
    }

    persistirContacto(contact, 'qr');
    // `currentUser` no aparece en el cuerpo pero la dependencia es REAL: `esYo` lee la
    // sesión activa, así que cambiar de cuenta tiene que recalcular esto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, getUserById, t, persistirContacto, confirmarReemplazoDeClave, setScanned, setPendingLinkContact]);

  const cerrarConfirmacionLink = useCallback(() => {
    if (!confirmedRef.current) volverAContactos();
    confirmedRef.current = false;
    setPendingLinkContact(null);
  }, [confirmedRef, setPendingLinkContact]);

  const confirmarContactoDeLink = useCallback(() => {
    confirmedRef.current = true;
    const contact = pendingLinkContact;
    setPendingLinkContact(null);
    if (contact) persistirContacto(contact, 'link');
  }, [pendingLinkContact, persistirContacto, confirmedRef, setPendingLinkContact]);

  return { procesarContacto, cerrarConfirmacionLink, confirmarContactoDeLink };
}
