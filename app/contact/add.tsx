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

import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { hapticLight, hapticSuccess, hapticWarning } from '@/src/utils/haptics';
import {
  buildContactPayload, parseContactPayload, buildContactDeepLink, contactFromParams, parseContactLink,
  type ContactPayload,
} from '@/src/utils/contactLink';
import { ensureContactSecret, announceContact, savePeer } from '@/src/sync/contactChannel';
import { deviceId } from '@/src/sync/relayEngine';
import { ensureIdentity, ensureWrapKeypair } from '@/src/store/identityStore';
import { useTranslation } from 'react-i18next';
import { syncedNow } from '@/src/utils/syncedClock';
import { esYo } from '@/src/store/identityAlias';

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
  const deepLink  = currentUser ? buildContactDeepLink(currentUser, misClaves) : '';

  /**
   * Agrega un contacto que llegó por QR o por link. **Los dos caminos pasan por acá**:
   * antes el link se procesaba aparte, en `_layout.tsx`, agregaba en silencio y dejaba
   * al usuario mirando SU PROPIO QR, sin ningún aviso de que el contacto había entrado.
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

    hapticSuccess();
    addOrUpdateUser({
      id:           contact.id,
      name:         contact.name,
      email:        contact.email ?? '',
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
  }, [currentUser, addOrUpdateUser, getUserById, t]);

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

  async function handleShare() {
    hapticLight();
    try {
      await Share.share({
        message: t('contact.share_message', { link: deepLink }),
        title: t('contact.share_title'),
      });
    } catch {
      // user cancelled
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>

      <DetailHeader icon="close" title={t('contact.title')} onBack={() => router.back()} />

      {/* Mode tabs */}
      <View style={[styles.tabs, { backgroundColor: c.bgGrouped }]}>
        <Pressable
          onPress={() => { hapticLight(); setMode('my_qr'); setScanned(false); }}
          style={[styles.tab, mode === 'my_qr' && { backgroundColor: c.surface }]}
        >
          <Ionicons name="qr-code-outline" size={16} color={mode === 'my_qr' ? c.text : c.textSecondary} />
          <Text style={[Typography.bodyS, { color: mode === 'my_qr' ? c.text : c.textSecondary, fontWeight: '600' }]}>
            {t('contact.tab_my_qr')}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => { hapticLight(); setMode('scan'); setScanned(false); }}
          style={[styles.tab, mode === 'scan' && { backgroundColor: c.surface }]}
        >
          <Ionicons name="scan-outline" size={16} color={mode === 'scan' ? c.text : c.textSecondary} />
          <Text style={[Typography.bodyS, { color: mode === 'scan' ? c.text : c.textSecondary, fontWeight: '600' }]}>
            {t('contact.tab_scan')}
          </Text>
        </Pressable>
      </View>

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

              <View style={styles.dividerRow}>
                <View style={[styles.dividerLine, { backgroundColor: c.hair }]} />
                <Text style={[Typography.caption, { color: c.textTertiary, paddingHorizontal: 10 }]}>{t('contact.or')}</Text>
                <View style={[styles.dividerLine, { backgroundColor: c.hair }]} />
              </View>

              <Pressable
                onPress={handleShare}
                style={[styles.shareBtn, { backgroundColor: c.surface, borderColor: c.hair }]}
              >
                <Ionicons name="share-outline" size={20} color={c.brand.primary} />
                <Text style={[Typography.bodyM, { color: c.brand.primary, fontWeight: '700' }]}>
                  {t('contact.share_link')}
                </Text>
              </Pressable>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1 },
  tabs:       {
    flexDirection: 'row', margin: Spacing.screenPad,
    borderRadius: Radius.md, padding: 4, gap: 4,
  },
  tab:        {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 8, borderRadius: Radius.sm,
  },
  qrContent:  {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: Spacing.screenPad, paddingBottom: Spacing[8],
  },
  qrCard:     {
    padding: 24, borderRadius: Radius.xl,
    boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
  },
  dividerRow:    { flexDirection: 'row', alignItems: 'center', width: '100%', marginVertical: Spacing[4] },
  dividerLine:   { flex: 1, height: 1 },
  shareBtn:      {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    width: '100%', padding: 14,
    borderRadius: Radius.lg, borderWidth: 1,
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
