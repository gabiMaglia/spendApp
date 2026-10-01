import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useAuthStore } from '@/src/store/authStore';
import { peersIncompletos } from '@/src/sync/contactos/contactChannel';
import { useLiveValue } from '@/src/hooks/useLiveValue';
import { SoloEnDesarrollo } from '@/src/components/SoloEnDesarrollo';
import { useColors } from '@/src/skins/useSkin';
import { Aviso } from '@/src/screens/debug/components/Filas';
import { BloqueCuentaActiva } from '@/src/screens/debug/components/BloqueCuentaActiva';
import { BloqueSync } from '@/src/screens/debug/components/BloqueSync';
import { AvisoPublicacionBloqueada } from '@/src/screens/debug/components/AvisoPublicacionBloqueada';
import { BloqueDirectorio } from '@/src/screens/debug/components/BloqueDirectorio';
import { BloqueFirmas } from '@/src/screens/debug/components/BloqueFirmas';
import { BloqueReloj } from '@/src/screens/debug/components/BloqueReloj';
import { BloqueCuentasConocidas } from '@/src/screens/debug/components/BloqueCuentasConocidas';
import { BloqueLogDeRenders } from '@/src/screens/debug/components/BloqueLogDeRenders';
import { BloqueEmpezarDeCero } from '@/src/screens/debug/components/BloqueEmpezarDeCero';
import { BloqueDatosDeDemo } from '@/src/screens/debug/components/BloqueDatosDeDemo';

/**
 * Diagnóstico del índice de identidad (solo DEV).
 *
 * Existe porque "sigo viendo dos cuentas" es un síntoma que se puede explicar de
 * varias formas —código viejo en el bundle, el índice vacío, el usuario eligió
 * "cuenta aparte"— y adivinar cuál sale caro. Acá se ve el estado real.
 *
 * T-223: cada bloque vive en `src/screens/debug/components/`, con los
 * `useLiveValue` del dato que muestra.
 */
function PantallaIdentidad() {
  const c = useColors();

  /**
   * `identitySnapshot` lee de MMKV, no del estado del store, así que
   * seleccionarlo y llamarlo no suscribe a nada: leía disco en CADA render y
   * nunca se actualizaba al cambiar de cuenta. Es la misma forma rota que el
   * contador de avisos, encontrada por el guard de `sinLeerDelStore`.
   *
   * `useLiveValue` es lo que esta misma pantalla ya usa para los contadores de
   * la fase B, por la misma razón: valores que viven fuera de React.
   */
  const snapshot = useLiveValue(() => useAuthStore.getState().identitySnapshot());
  const dosCuentas = snapshot.known.length > 1;

  // Lo usan el bloque SYNC y el aviso de contactos a medias.
  const incompletos = peersIncompletos().length;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="close" size={24} color={c.text} />
        </Pressable>
        <Text style={[Typography.h3, { color: c.text }]}>Identidad (DEV)</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <BloqueDatosDeDemo c={c} />
        <BloqueCuentaActiva accountId={snapshot.activeAccountId} c={c} />
        <BloqueSync incompletos={incompletos} c={c} />
        <AvisoPublicacionBloqueada c={c} />
        <BloqueDirectorio cuenta={snapshot.activeAccountId} c={c} />
        <BloqueFirmas c={c} />
        <BloqueReloj c={c} />

        {incompletos > 0 && (
          <Aviso color={c.semantic.warning} titulo={`${incompletos} contacto(s) a medias`}>
            <Text style={[Typography.bodyS, { color: c.textSecondary }]}>
              Se agregaron con una versión anterior del código, que no mandaba las
              claves públicas. Sin ellas no se les puede entregar la clave de un
              grupo. La app les manda la tarjeta al arrancar; si los dos abren la
              app queda reparado solo. Si no, volvé a escanear el QR.
            </Text>
          </Aviso>
        )}

        <BloqueCuentasConocidas snapshot={snapshot} c={c} />
        <BloqueLogDeRenders c={c} />
        <BloqueEmpezarDeCero c={c} />

        {dosCuentas && (
          <Aviso color={c.semantic.negative} titulo={`Hay ${snapshot.known.length} cuentas separadas`}>
            <Text style={[Typography.bodyS, { color: c.textSecondary }]}>
              Si sos la misma persona, al entrar con el otro proveedor la app tiene
              que preguntarte si querés unirlas. Si NO te preguntó, mandale esta
              pantalla al equipo: con los mails de arriba se sabe por qué.
            </Text>
          </Aviso>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], padding: Spacing.screenPad },
  scroll: { padding: Spacing.screenPad, gap: Spacing[6] },
});

export default function DebugIdentity() {
  return <SoloEnDesarrollo><PantallaIdentidad /></SoloEnDesarrollo>;
}
