import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FondoMarmol } from '@/src/components/FondoMarmol';
import { conAlfa } from '@/src/skins/color';
import { useSkin, useSkinTokens } from '@/src/skins/useSkin';
import { VidrioMarmol } from './VidrioMarmol';
import { VELO_DEBAJO, VELO_OPACIDAD } from './VeloHeader';
import { AERO_RADIO, AERO_TOPE } from './headerAeroGeometria';

/** Alto de la barra del header de detalle (back + título + acción). */
export const DETAIL_BAR_H = 52;
/** La tarjeta suma su borde de arriba y el de abajo. */
const BORDES_TARJETA = 2;

/**
 * Cuánto tiene que bajar el contenido de una pantalla de detalle para
 * arrancar debajo de la tarjeta del header. En Aero el header flota (el
 * contenido pasa por detrás); en Clásico está en el flujo y no hace falta.
 */
export function useRellenoDetailHeader(): number {
  const soft = useSkinTokens().flags.soft;
  const insets = useSafeAreaInsets();
  return soft ? insets.top + AERO_TOPE + DETAIL_BAR_H + BORDES_TARJETA : 0;
}

/** Hueco del header para pantallas de detalle SIN scroll (en Clásico no dibuja nada). */
export function RellenoDetailHeader() {
  const alto = useRellenoDetailHeader();
  if (alto === 0) return null;
  return <View testID="relleno-detail-header" style={{ height: alto }} pointerEvents="none" />;
}

/**
 * **Header de detalle del Aero** (T-227 punto 5, PO 2026-09-29): la tarjeta
 * flota sobre el contenido, con el mismo velo que el header de las pestañas
 * (`VeloHeader`) del borde de arriba hasta `VELO_DEBAJO` debajo de ella. El
 * detalle no colapsa, así que acá no hay animación. Cada pantalla baja su
 * contenido con `useRellenoDetailHeader`.
 */
export function DetailHeaderAero({ children }: { children: React.ReactNode }) {
  const { skin, degradado } = useSkin();
  const c = skin.colors;
  const insets = useSafeAreaInsets();
  const relleno = useRellenoDetailHeader();
  const sombra = degradado
    ? { elevation: skin.elevation.e2.elevationFallback }
    : { boxShadow: skin.elevation.e2.boxShadow };

  return (
    <View testID="detail-header-flota" style={styles.capa} pointerEvents="box-none">
      <View
        testID="velo-detail-header"
        pointerEvents="none"
        style={[styles.velo, { height: relleno + VELO_DEBAJO, backgroundColor: conAlfa(c.bg, VELO_OPACIDAD) }]}
      />
      <View
        testID="detail-header-aero"
        style={[
          styles.tarjeta,
          { marginTop: insets.top + AERO_TOPE, marginHorizontal: skin.space.inset },
          { backgroundColor: c.surface, borderColor: c.hair },
          sombra,
        ]}
      >
        <FondoMarmol patron="franja" />
        <VidrioMarmol />
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  capa: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20 },
  velo: { position: 'absolute', top: 0, left: 0, right: 0 },
  tarjeta: { borderWidth: 1, borderRadius: AERO_RADIO, overflow: 'hidden' },
});
