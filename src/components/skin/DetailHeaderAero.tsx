import React, { createContext, useContext } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
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

const EnModalContext = createContext(false);

/**
 * Envuelve una pantalla que se abre como modal (`presentation: 'modal'`). En
 * iOS el modal es una hoja que ya arranca debajo de la barra de estado: el
 * header de Aero no tiene que sumar el inset de arriba, o queda flotando muy
 * abajo (PO 2026-10-11). En Android el modal es de pantalla completa y sí.
 */
export function EnModal({ children }: { children: React.ReactNode }) {
  return <EnModalContext.Provider value>{children}</EnModalContext.Provider>;
}

/** El inset de arriba que tiene que despejar el header de Aero en esta pantalla. */
function useInsetSuperior(): number {
  const enModal = useContext(EnModalContext);
  const insets = useSafeAreaInsets();
  return enModal && Platform.OS === 'ios' ? 0 : insets.top;
}

/**
 * Cuánto tiene que bajar el contenido de una pantalla de detalle para
 * arrancar debajo de la tarjeta del header. En Aero el header flota (el
 * contenido pasa por detrás); en Clásico está en el flujo y no hace falta.
 */
export function useRellenoDetailHeader(): number {
  const soft = useSkinTokens().flags.soft;
  const top = useInsetSuperior();
  return soft ? top + AERO_TOPE + DETAIL_BAR_H + BORDES_TARJETA : 0;
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
  const top = useInsetSuperior();
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
          { marginTop: top + AERO_TOPE, marginHorizontal: skin.space.inset },
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
