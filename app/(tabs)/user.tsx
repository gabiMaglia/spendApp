import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useHeaderColapsable } from '@/src/hooks/useHeaderColapsable';
import { useRellenoBarraPestanas } from '@/src/hooks/useRellenoBarraPestanas';
import { useTranslation } from 'react-i18next';

import { Spacing } from '@/src/constants/spacing';
import { AvatarCropSheet } from '@/src/components/AvatarCropSheet';
import { useAuthStore } from '@/src/store/authStore';
import { PRO_DISPONIBLE } from '@/src/store/tierStore';
import { SyncNoDisponible } from '@/src/components/SyncNoDisponible';
import { SinSesionDeSync } from '@/src/components/SinSesionDeSync';
import { TabHeader } from '@/src/components/TabHeader';
import { useHeaderPadding, useLimiteContenido } from '@/src/components/CollapsibleHeader';
import { BudgetSheet } from '@/src/components/BudgetSheet';
import { useColors } from '@/src/skins/useSkin';
import { useEditarPerfil } from '@/src/screens/cuenta/hooks/useEditarPerfil';
import { useFotoDePerfil } from '@/src/screens/cuenta/hooks/useFotoDePerfil';
import { useRespaldo } from '@/src/screens/cuenta/hooks/useRespaldo';
import { TarjetaMiCuenta } from '@/src/screens/cuenta/components/TarjetaMiCuenta';
import { HojaEditarPerfil } from '@/src/screens/cuenta/components/HojaEditarPerfil';
import { SeccionPlan } from '@/src/screens/cuenta/components/SeccionPlan';
import { SeccionesDePreferencias } from '@/src/screens/cuenta/components/SeccionesDePreferencias';
import { SeccionRespaldo } from '@/src/screens/cuenta/components/SeccionRespaldo';
import { PieDeCuenta } from '@/src/screens/cuenta/components/PieDeCuenta';

/**
 * **Cuenta («Yo»).**
 *
 * T-223 (PO 2026-09-29): esta pantalla tenía 664 líneas. Acá queda el scroll,
 * el header colapsable y el orden de los bloques; cada bloque, la edición del
 * perfil, la foto y el respaldo viven en `src/screens/cuenta/`.
 */
export default function UserScreen() {
  const headerPad = useHeaderPadding(0);
  const limiteContenido = useLimiteContenido();
  const c = useColors();
  const { t } = useTranslation();
  const { currentUser, isPro, signOut } = useAuthStore();
  const { scrollHandler, progress, contenidoMinimo, alMedirScroll } = useHeaderColapsable();
  // Aero: la barra flota sobre el contenido; su alto queda libre abajo (T-227).
  const barra = useRellenoBarraPestanas();

  const perfil = useEditarPerfil(currentUser);
  const foto = useFotoDePerfil();
  const [showBudgetSheet, setShowBudgetSheet] = useState(false);
  const respaldo = useRespaldo();

  // Sin 'bottom': la tab bar ya reserva el inset del sistema (_layout.tsx); contarlo acá dejaba una franja muerta entre el contenido y la barra.
  return (
    <SafeAreaView edges={[]} style={[styles.safe, { backgroundColor: c.bg }]}>
      <Animated.ScrollView
        style={limiteContenido}
        onLayout={alMedirScroll}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={scrollHandler}
        // paddingBottom 120→Spacing[6] (PO 2026-09-13): ese colchón grande era
        // para dejar lugar al FAB de otras tabs; "Yo" no tiene uno y el fondo
        // de la versión quedaba con un salto enorme y vacío. La SafeAreaView
        // (`edges=['bottom']`) ya cubre el inset del sistema, y como la tab
        // bar no es `position:absolute` React Navigation ya reserva su alto.
        contentContainerStyle={[{ paddingTop: headerPad, paddingBottom: Spacing[6] + barra }, contenidoMinimo]}
      >

        {/* Mi cuenta */}
        <TarjetaMiCuenta currentUser={currentUser} onCambiarFoto={foto.cambiarFoto} onEditar={perfil.openEditProfile} />

        <HojaEditarPerfil perfil={perfil} />

        {/* Plan — oculto mientras Pro no exista: ver PRO_DISPONIBLE en tierStore. */}
        {PRO_DISPONIBLE && <SeccionPlan isPro={isPro} />}

        <SeccionesDePreferencias onEditarPresupuesto={() => setShowBudgetSheet(true)} />

        <SeccionRespaldo respaldo={respaldo} />

        <SyncNoDisponible />
        <SinSesionDeSync />

        <PieDeCuenta signOut={signOut} />
      </Animated.ScrollView>

      <TabHeader title={t('profile.title')} progress={progress} />

      <AvatarCropSheet
        visible={foto.aRecortar !== null}
        uri={foto.aRecortar?.uri ?? null}
        width={foto.aRecortar?.width ?? 1}
        height={foto.aRecortar?.height ?? 1}
        onCancel={foto.cancelarRecorte}
        onConfirm={foto.confirmarRecorte}
      />

      <BudgetSheet visible={showBudgetSheet} onClose={() => setShowBudgetSheet(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1 },
});
