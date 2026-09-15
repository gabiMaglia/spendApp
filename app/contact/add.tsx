import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Platform, Pressable, Share, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import QRCode from 'react-native-qrcode-svg';

import { Colors } from '@/src/constants/colors';
import { DetailHeader } from '@/src/components/CollapsibleHeader';
import { Segmented } from '@/src/components/Band';
import { Fab, FabRow } from '@/src/components/Fab';
import { ConfirmSheet } from '@/src/components/Sheet';

import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { hapticLight, hapticSuccess, hapticWarning } from '@/src/utils/haptics';
import {
  buildContactPayload, parseContactPayload, contactFromParams, parseContactLink,
  type ContactPayload,
} from '@/src/utils/contactLink';
import { createContactInvite, contactInviteToLink } from '@/src/sync/contactInvite';
import { ensureContactSecret, announceContact, savePeer, hasConflictingPinnedKeys } from '@/src/sync/contactChannel';
import { deviceId } from '@/src/sync/relayEngine';
import { ensureIdentity, ensureWrapKeypair, saveContactInvite } from '@/src/store/identityStore';
import { useTranslation } from 'react-i18next';
import { syncedNow } from '@/src/utils/syncedClock';
import { esYo } from '@/src/store/identityAlias';
import { shortFingerprint } from '@/src/utils/keyFingerprint';

type Mode = 'my_qr' | 'scan';

/**
 * Vuelve a Contactos. Si la pantalla se abrió por deep link no hay a dónde volver, y
 * `router.back()` no haría nada: se reemplaza por la pestaña.
 */
function volverAContactos() {
  if (router.canGoBack()) router.back();
  else router.replace('/(tabs)/friends');
}

export default function AddContactScreen() {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const c = Colors[scheme];
  const { currentUser } = useAuthStore();
  const { addOrUpdateUser, getUserById } = useUserStore();

  const [mode, setMode]           = useState<Mode>('my_qr');
  const [scanned, setScanned]     = useState(false);
  const [permission, requestPerm] = useCameraPermissions();
  // Contacto que llegó por LINK y espera confirmación explícita (T-093 / SEC H-1):
  // ver `procesarContacto`.
  const [pendingLinkContact, setPendingLinkContact] = useState<ContactPayload | null>(null);
  // Distingue "cerró tras confirmar" de "canceló": el `SheetButton` de confirmar
  // llama a `onConfirm` y a `onClose` en la MISMA pulsación, y `onClose` no debe
  // volver a Contactos si ya lo hizo `persistirContacto`.
  const confirmedRef = useRef(false);

  useEffect(() => {
    if (mode === 'scan' && !permission?.granted) {
      requestPerm();
    }
  }, [mode]);

  // El secreto viaja en el código: es lo que permite que quien me escanee me
  // devuelva su tarjeta y el contacto quede en los dos teléfonos.
  const misClaves = currentUser ? {
    secret:            ensureContactSecret() ?? undefined,
    wrapPublicKey:     ensureWrapKeypair().publicKey,
    identityPublicKey: ensureIdentity().publicKey,
  } : null;
  const myQRData  = currentUser ? buildContactPayload(currentUser, misClaves) : '';

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
  const persistirContacto = useCallback((contact: ContactPayload, origen: 'qr' | 'link') => {
    const cerrar = origen === 'link' ? volverAContactos : () => setScanned(false);

    if (esYo(contact.id)) {
      cerrar();
      return;
    }

    if (getUserById(contact.id) && !getUserById(contact.id)?.isDeleted) {
      hapticLight();
      Alert.alert(t('contact.already_title'), t('contact.already_body', { name: contact.name }), [
        { text: 'OK', onPress: volverAContactos },
      ]);
      return;
    }

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
    // teléfonos con un solo escaneo. Va sin await — que el alta local no dependa
    // de la red — y si falla, lo peor que pasa es lo que pasaba antes.
    const mutuo = Boolean(contact.secret);
    if (contact.secret) {
      savePeer(contact.id, {
        secret: contact.secret,
        wrapPublicKey: contact.wrapPublicKey,
        identityPublicKey: contact.identityPublicKey,
      });
      void announceContact(contact.secret, deviceId());
    }
    /**
     * **El alta cierra la pantalla en el acto** (PO, 2026-09-12), y el cartel aparece ya
     * sobre Contactos. Antes cerraba el «OK» del cartel, y en Android tocar fuera lo
     * descarta sin llamar a `onPress`: quedabas en la cámara, con el escaneo trabado.
     *
     * Con secreto en el código el alta es MUTUA: un escaneo y listo. Sin él (códigos
     * viejos) sigue siendo de una sola dirección, y ahí la app dice la verdad en vez de
     * dejar al usuario creyendo que están conectados los dos.
     */
    volverAContactos();
    if (mutuo) {
      Alert.alert(
        t('contact.added_title'),
        t('contact.added_both_body', { name: contact.name }),
        [{ text: 'OK' }],
      );
      return;
    }

    Alert.alert(
      t('contact.added_title'),
      t('contact.added_half_body', { name: contact.name }),
      [
        { text: t('contact.later'), style: 'cancel' },
        // La pantalla ya se cerró: mostrar mi código es volver a abrirla (arranca en «mi QR»).
        { text: t('contact.show_my_code'), onPress: () => router.push('/contact/add') },
      ],
    );
    // `currentUser` no aparece en el cuerpo pero la dependencia es REAL: `esYo` lee la
    // sesión activa, así que cambiar de cuenta tiene que recalcular esto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addOrUpdateUser, getUserById, t, currentUser]);

  /**
   * Evalúa un contacto que llegó por QR o por link. **Los dos caminos pasan por acá**:
   * antes el link se procesaba aparte, en `_layout.tsx`, agregaba en silencio y dejaba
   * al usuario mirando SU PROPIO QR, sin ningún aviso de que el contacto había entrado.
   *
   * De acá en más NO escribe nada por su cuenta: sólo decide entre "no hay nada que
   * hacer" (ya es mío / ya existe / las claves no coinciden), "persistir ya" (QR — el
   * escaneo presencial YA es el consentimiento, T-093 criterio 4) o "pedir confirmación"
   * (link — nadie estuvo delante, T-093 / SEC H-1 criterio 1).
   */
  const procesarContacto = useCallback((contact: ContactPayload, origen: 'qr' | 'link') => {
    if (esYo(contact.id)) {
      hapticWarning();
      Alert.alert(
        t('contact.own_qr_title'),
        t(origen === 'link' ? 'contact.own_link_body' : 'contact.own_qr_body'),
        [{ text: 'OK', onPress: () => (origen === 'link' ? volverAContactos() : setScanned(false)) }],
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

    // Ni por link ni por QR se pisa una clave ya pinneada que no coincide — ni la de un
    // contacto borrado (tombstone): el peer sobrevive al borrado. T-093 / SEC H-1 criterio 2.
    if (contact.secret && hasConflictingPinnedKeys(contact.id, {
      secret: contact.secret,
      wrapPublicKey: contact.wrapPublicKey,
      identityPublicKey: contact.identityPublicKey,
    })) {
      hapticWarning();
      Alert.alert(
        t('contact.keys_changed_title'),
        t('contact.keys_changed_body', { name: contact.name }),
        [{ text: 'OK', onPress: origen === 'link' ? volverAContactos : () => setScanned(false) }],
      );
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
  }, [currentUser, getUserById, t, persistirContacto]);

  const cerrarConfirmacionLink = useCallback(() => {
    if (!confirmedRef.current) volverAContactos();
    confirmedRef.current = false;
    setPendingLinkContact(null);
  }, []);

  const confirmarContactoDeLink = useCallback(() => {
    confirmedRef.current = true;
    const contact = pendingLinkContact;
    setPendingLinkContact(null);
    if (contact) persistirContacto(contact, 'link');
  }, [pendingLinkContact, persistirContacto]);

  const handleBarCodeScanned = useCallback(({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);

    const contact = parseContactPayload(data) ?? parseContactLink(data);
    if (!contact) {
      hapticWarning();
      Alert.alert(t('contact.unknown_qr_title'), t('contact.unknown_qr_body'), [
        { text: t('contact.rescan'), onPress: () => setScanned(false) },
        { text: t('common.cancel'), style: 'cancel', onPress: () => router.back() },
      ]);
      return;
    }

    procesarContacto(contact, 'qr');
  }, [scanned, procesarContacto, t]);

  /**
   * Abierta por un link de contacto (`/contact/add?id=…&name=…`): se procesa como un
   * escaneo. Una sola vez por pantalla — un re-render no puede volver a agregar — y
   * recién con sesión: sin ella, `_layout` guarda el link y lo reabre después del login.
   */
  const params = useLocalSearchParams();
  const linkProcesado = useRef(false);
  useEffect(() => {
    if (linkProcesado.current || !currentUser) return;
    const contact = contactFromParams(params as Record<string, unknown>);
    if (!contact) return;
    linkProcesado.current = true;
    procesarContacto(contact, 'link');
  }, [params, currentUser, procesarContacto]);

  /**
   * Arma el link de invitación de contacto recién ACÁ, al tocar "Compartir" —
   * no en el cuerpo del componente (I2, revisión final de T-096 · ADR-015).
   * Calcularlo en render minaba un token nuevo en cada re-render (cualquier
   * cambio de store, cambio de pestaña) y lo persistía en `saveContactInvite`
   * sin que el usuario hubiera compartido nada todavía — invitaciones muertas
   * acumulándose en `K_CONTACT_INVITES` y un riesgo real de que el token
   * mostrado en un render no fuera el mismo que terminaba compartiéndose.
   *
   * `saveContactInvite` (C1, revisión final): sin esto la invitación nunca
   * quedaba en el storage de quien comparte, así que `activeContactInvites`/
   * `processAllContactInvites` no la procesaban nunca del lado de quien
   * comparte — el link de "Compartir" no completaba jamás, aunque alguien lo
   * reclamara. Mismo patrón que `handleShareInvite` en `app/groups/[id].tsx`
   * (`createInvite` + `saveInvite` explícitos en el handler, no dentro de
   * `createInvite`/`createContactInvite`).
   */
  async function handleShare() {
    if (!currentUser) return;
    // Sin háptico acá: el `Fab` ya lo dispara al tocarlo.
    const invite = createContactInvite(currentUser.name, ensureIdentity().publicKey, ensureWrapKeypair().publicKey);
    saveContactInvite(invite);
    try {
      await Share.share({
        message: t('contact.share_message', { link: contactInviteToLink(invite) }),
        title: t('contact.share_title'),
      });
    } catch {
      // user cancelled
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>

      <DetailHeader icon="close" title={t('contact.title')} onBack={() => router.back()} />

      {/* Mi QR / Escanear: las pestañas comunes de la app («T invertida»). */}
      <Segmented
        variant="tabs"
        value={mode}
        onChange={m => { hapticLight(); setMode(m); setScanned(false); }}
        options={[
          { key: 'my_qr', label: t('contact.tab_my_qr'), icon: 'qr-code-outline' },
          { key: 'scan',  label: t('contact.tab_scan'),  icon: 'scan-outline' },
        ]}
      />

      {/* Content */}
      {mode === 'my_qr' ? (
        <View style={styles.qrContent}>
          {currentUser ? (
            <>
              <View style={[styles.qrCard, { backgroundColor: '#fff' }]}>
                <QRCode
                  value={myQRData}
                  size={220}
                  color="#0A1A22"
                  backgroundColor="#fff"
                />
              </View>
              <Text style={[Typography.h3, { color: c.text, marginTop: Spacing[4] }]}>
                {currentUser.name}
              </Text>
              <Text style={[Typography.bodyM, { color: c.textSecondary, marginTop: 4, textAlign: 'center' }]}>
                {t('contact.my_qr_hint')}
              </Text>

            </>
          ) : (
            <Text style={[Typography.bodyM, { color: c.textTertiary }]}>{t('common.loading')}</Text>
          )}
        </View>
      ) : (
        /* Scan mode */
        <View style={styles.scanContent}>
          {!permission?.granted ? (
            <View style={styles.permBox}>
              <Ionicons name="camera-outline" size={48} color={c.textTertiary} />
              <Text style={[Typography.bodyM, { color: c.textSecondary, textAlign: 'center' }]}>
                {t('contact.cam_permission')}
              </Text>
              <Pressable
                onPress={requestPerm}
                style={[styles.permBtn, { backgroundColor: c.brand.primary }]}
              >
                <Text style={[Typography.bodyM, { color: '#fff', fontWeight: '700' }]}>
                  {t('contact.grant_permission')}
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.cameraBox}>
              <CameraView
                style={StyleSheet.absoluteFillObject}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
              />
              {/* Frame overlay */}
              <View style={styles.overlay}>
                <View style={styles.frame} />
                <Text style={[Typography.bodyM, { color: '#fff', marginTop: 24, textAlign: 'center' }]}>
                  {t('contact.scan_hint')}
                </Text>
              </View>
              {scanned && (
                <Pressable
                  onPress={() => setScanned(false)}
                  style={[styles.rescanBtn, { backgroundColor: c.brand.primary }]}
                >
                  <Text style={[Typography.bodyM, { color: '#fff', fontWeight: '700' }]}>
                    {t('contact.rescan')}
                  </Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      )}

      {/* Compartir va abajo, flotante, como toda botonera del pie (FabRow + Fab). Sólo en
          «Mi QR»: en «Escanear» taparía la cámara, y lo que se comparte es mi código. */}
      {mode === 'my_qr' && currentUser && (
        <FabRow>
          <Fab
            testID="contact-share-link"
            onPress={handleShare}
            icon="share-outline"
            label={t('contact.share_link')}
            backgroundColor={c.brand.primary}
          />
        </FabRow>
      )}

      {/* Confirmación de contacto por link (T-093 / SEC H-1): nadie estuvo delante, así
          que antes de agregar/pinnear/anunciar se muestra nombre + huella de su clave. */}
      <ConfirmSheet
        visible={!!pendingLinkContact}
        onClose={cerrarConfirmacionLink}
        onConfirm={confirmarContactoDeLink}
        danger={false}
        title={t('contact.confirm_title', { name: pendingLinkContact?.name ?? '' })}
        body={
          pendingLinkContact?.identityPublicKey
            ? t('contact.confirm_body', { fingerprint: shortFingerprint(pendingLinkContact.identityPublicKey) })
            : t('contact.confirm_no_key')
        }
        confirmLabel={t('contact.confirm_add')}
        cancelLabel={t('common.cancel')}
        confirmTestID="contact-confirm-add"
        cancelTestID="contact-confirm-cancel"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1 },
  qrContent:  {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    // Lugar para el botón flotante de compartir (48 de alto + su separación del borde),
    // así el QR no queda debajo.
    paddingHorizontal: Spacing.screenPad, paddingBottom: 96,
  },
  qrCard:     {
    padding: 24, borderRadius: Radius.xl,
    boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
  },
  scanContent:   { flex: 1 },
  cameraBox:     { flex: 1, position: 'relative' },
  overlay:       {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
  },
  frame:         {
    width: 220, height: 220, borderRadius: 16,
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)',
  },
  rescanBtn:     {
    position: 'absolute', bottom: 40,
    alignSelf: 'center', paddingHorizontal: 28, paddingVertical: 14,
    borderRadius: Radius.full,
  },
  permBox:       {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: Spacing[8], gap: Spacing[4],
  },
  permBtn:       { paddingHorizontal: 24, paddingVertical: 12, borderRadius: Radius.full },
});
