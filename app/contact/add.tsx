import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useCameraPermissions } from 'expo-camera';
import { useTranslation } from 'react-i18next';

import { DetailHeader, RellenoDetailHeader } from '@/src/components/CollapsibleHeader';
import { Segmented } from '@/src/components/Band';
import { Fab, FabRow } from '@/src/components/Fab';

import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { hapticLight, hapticWarning } from '@/src/utils/haptics';
import {
  buildContactPayload, parseContactPayload, contactFromParams, parseContactLink,
  type ContactPayload,
} from '@/src/utils/contactLink';
import { ensureContactSecret } from '@/src/sync/contactos/contactChannel';
import { ensureIdentity, ensureWrapKeypair } from '@/src/store/identityStore';
import { useColors } from '@/src/skins/useSkin';
import { useCierreAlAltaRemota, type ModoAgregarContacto } from '@/src/screens/contact/hooks/useCierreAlAltaRemota';
import { usePersistirContacto } from '@/src/screens/contact/hooks/usePersistirContacto';
import { useProcesarContacto } from '@/src/screens/contact/hooks/useProcesarContacto';
import { compartirMiContacto } from '@/src/screens/contact/compartirMiContacto';
import { MiCodigoQR } from '@/src/screens/contact/components/MiCodigoQR';
import { EscanerDeContacto } from '@/src/screens/contact/components/EscanerDeContacto';
import { ConfirmarContactoDeLink } from '@/src/screens/contact/components/ConfirmarContactoDeLink';

export default function AddContactScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { currentUser } = useAuthStore();
  const addOrUpdateUser = useUserStore(s => s.addOrUpdateUser);
  const getUserById = useUserStore(s => s.getUserById);

  // `?mode=scan` abre directo en la cámara — usado por «Validar miembro» desde un grupo
  // (T-101): no hay razón para hacer pasar a alguien por «Mi QR» primero.
  const params = useLocalSearchParams();
  const [mode, setMode] = useState<ModoAgregarContacto>(params.mode === 'scan' ? 'scan' : 'my_qr');
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

  const cerradoPorAltaRef = useCierreAlAltaRemota(mode);

  // El secreto viaja en el código: es lo que permite que quien me escanee me
  // devuelva su tarjeta y el contacto quede en los dos teléfonos.
  const misClaves = currentUser ? {
    secret:            ensureContactSecret() ?? undefined,
    wrapPublicKey:     ensureWrapKeypair().publicKey,
    identityPublicKey: ensureIdentity().publicKey,
  } : null;
  const myQRData  = currentUser ? buildContactPayload(currentUser, misClaves) : '';

  const persistirContacto = usePersistirContacto({
    currentUser, addOrUpdateUser, getUserById, t, setScanned, cerradoPorAltaRef,
  });
  const { procesarContacto, cerrarConfirmacionLink, confirmarContactoDeLink } = useProcesarContacto({
    currentUser, addOrUpdateUser, getUserById, t, setScanned,
    persistirContacto, pendingLinkContact, setPendingLinkContact, confirmedRef,
  });

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
  const linkProcesado = useRef(false);
  useEffect(() => {
    if (linkProcesado.current || !currentUser) return;
    const contact = contactFromParams(params as Record<string, unknown>);
    if (!contact) return;
    linkProcesado.current = true;
    procesarContacto(contact, 'link');
  }, [params, currentUser, procesarContacto]);

  const handleShare = () => compartirMiContacto(currentUser, t);

  return (
    <SafeAreaView edges={['bottom']} style={[styles.safe, { backgroundColor: c.bg }]}>

      <DetailHeader icon="close" title={t('contact.title')} onBack={() => router.back()} />
      <RellenoDetailHeader />

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
        <MiCodigoQR nombre={currentUser ? currentUser.name : null} qrData={myQRData} />
      ) : (
        <EscanerDeContacto
          permitido={!!permission?.granted}
          onPedirPermiso={requestPerm}
          scanned={scanned}
          onScanned={handleBarCodeScanned}
          onReescanear={() => setScanned(false)}
        />
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

      <ConfirmarContactoDeLink
        contacto={pendingLinkContact}
        onClose={cerrarConfirmacionLink}
        onConfirm={confirmarContactoDeLink}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1 },
});
