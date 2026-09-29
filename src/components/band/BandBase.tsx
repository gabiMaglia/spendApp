import React, { useContext } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { PanelContext } from '@/src/components/skin/PanelContext';
import type { SkinColors } from '@/src/skins/types';
import { useSkinTokens } from '@/src/skins/useSkin';
import { Panel, type PanelSegmento } from '@/src/components/skin/Panel';

/**
 * Primitivas del reskin "flat bands".
 *
 * La tarjeta flotante desaparece: un bloque es una BANDA de ancho completo con
 * hairline arriba y abajo, y sus filas se separan con un hairline más suave.
 * El padding horizontal vive en la FILA, no en la banda, así el divisor llega
 * de borde a borde.
 */

/**
 * Paleta de las primitivas: la del skin activo (con el default, exactamente
 * `Colors[scheme]`); adentro de un `Panel`, la que puso el panel.
 */
export function useC(): SkinColors {
  const skin = useSkinTokens();
  const panel = useContext(PanelContext);
  return panel?.colors ?? skin.colors;
}

/** Etiqueta de sección sobre una banda. `right` es un link o accesorio opcional. */
export function SectionLabel({
  label, right, first, topOverride, testID,
}: {
  label: string;
  right?: React.ReactNode;
  first?: boolean;
  /**
   * Reemplaza el `paddingTop` default de esta instancia puntual (T-108): el
   * aire entre el bloque de arriba y la agrupación de una lista se dobla
   * PANTALLA POR PANTALLA, nunca cambiando el default de `SectionLabel` — eso
   * afectaría también las etiquetas que separan grupos DENTRO de una misma
   * lista (ej. los encabezados de fecha de Actividad), que no se tocan.
   */
  topOverride?: number;
  testID?: string;
}) {
  const c = useC();
  return (
    <View
      testID={testID}
      style={[
        styles.sectionLabel,
        first && { paddingTop: Spacing[2] },
        topOverride !== undefined && { paddingTop: topOverride },
      ]}
    >
      <Text style={[Typography.label, { color: c.textTertiary, textTransform: 'uppercase' }]}>
        {label}
      </Text>
      {right}
    </View>
  );
}

/** Banda de ancho completo. `sunken` para el tono hundido (fila de neto, chips). */
export function Band({
  children, sunken, style, noBottom, noTop, segmento,
}: {
  children: React.ReactNode; sunken?: boolean; style?: ViewStyle; noBottom?: boolean;
  /**
   * Sin línea de arriba: la banda va PEGADA al bloque de encima y comparte su línea
   * divisoria (PO, 2026-09-12 — el input de descripción de un gasto). Con las dos líneas
   * se verían 2pt donde tiene que haber una.
   */
  noTop?: boolean;
  /**
   * T-154: cuando esta `Band` es UNA FILA de una lista virtualizada (cada
   * fila su propio ítem de FlashList, sin `Panel` padre compartido), pasa
   * este prop al `Panel` que auto-crea — así varias filas seguidas se leen
   * como una sola tarjeta continua en vez de una tarjeta por fila. Ver
   * `Panel.tsx`. Sin este prop, comportamiento intacto.
   */
  segmento?: PanelSegmento;
}) {
  const c = useC();
  const soft = useSkinTokens().flags.soft;
  // Dentro de un `Panel` del skin, el panel pone fondo/radio/sombra: la banda
  // no dibuja sus hairlines ni su fondo (salvo `sunken`, con el tono del skin).
  const panel = useContext(PanelContext);
  // Aero (etapa 2): una banda suelta se dibuja como panel. `style` va al panel
  // (es layout: flexGrow, márgenes). Bandas que deben ir juntas: `BandStack`.
  if (soft && !panel) {
    return (
      <Panel style={style} segmento={segmento}>
        <Band sunken={sunken} noTop={noTop} noBottom={noBottom}>{children}</Band>
      </Panel>
    );
  }
  return (
    <View
      style={[
        panel
          ? { backgroundColor: sunken ? panel.sunkenBg : 'transparent' }
          : {
              backgroundColor: sunken ? c.bgGrouped : c.surface,
              borderTopWidth: noTop ? 0 : 1,
              borderBottomWidth: noBottom ? 0 : 1,
              borderColor: c.hair,
            },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Fila de banda. `last` saca el divisor inferior. */
export function BandRow({
  children, onPress, last, style, accessibilityRole, testID,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  last?: boolean;
  style?: ViewStyle;
  /** Para filas que son una acción (p. ej. «Eliminar gasto», T-107). */
  accessibilityRole?: 'button' | 'link';
  testID?: string;
}) {
  const c = useC();
  // Dentro de un `Panel`, el divisor es el suave del skin (`edgeShade`).
  const panel = useContext(PanelContext);
  const base: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: Spacing.screenPad,
    paddingVertical: Spacing.rowPadV,
    borderBottomWidth: last ? 0 : 1,
    borderBottomColor: panel ? panel.colors.edgeShade : c.hair2,
  };
  if (!onPress) return <View testID={testID} style={[base, style]}>{children}</View>;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole={accessibilityRole}
      style={({ pressed }) => [base, pressed && { backgroundColor: c.bgGrouped }, style]}
    >
      {children}
    </Pressable>
  );
}

/** Barra de progreso plana de 4-5pt. */
export function Meter({ pct, color, height = 5 }: { pct: number; color?: string; height?: number }) {
  const c = useC();
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: c.hair2, overflow: 'hidden' }}>
      <View
        style={{
          width: `${Math.max(0, Math.min(pct, 1)) * 100}%`,
          height: '100%',
          backgroundColor: color ?? c.brand.primary,
        }}
      />
    </View>
  );
}

/** Badge de esquina para estados no implementados. */
export function SoonBadge({ label = 'SOON' }: { label?: string }) {
  const c = useC();
  return (
    <View style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: c.hair2 }}>
      <Text style={{ fontSize: 9.5, fontWeight: '600', letterSpacing: 0.6, color: c.textTertiary }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad,
    paddingTop: 22,
    paddingBottom: 9,
  },
});
