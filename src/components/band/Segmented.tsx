import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Spacing } from '@/src/constants/spacing';
import { useSkinTokens } from '@/src/skins/useSkin';
import { useC } from '@/src/components/band/BandBase';

/**
 * Control segmentado.
 *
 * `control` — la pastilla, para elegir DENTRO de un formulario (cómo dividir un
 * gasto, qué tema, qué idioma). `tabs` — para separar el contenido de una PANTALLA
 * (Gasto/Ingreso, Mi QR/Escanear, Activos/Archivados, la Bandeja, los filtros de
 * Actividad). Son dos trabajos distintos y por eso son dos looks.
 *
 * **`tabs` es la «T invertida»** (PO, 2026-09-12): una línea fina de borde a borde abajo
 * y una vertical entre celdas que baja a tocarla (⊥); ícono y texto flotando en el
 * centro de cada celda; la activa con fondo hundido y texto pleno. Va de borde a borde:
 * quien la usa no le pone padding lateral. Todas las pestañas de la app pasan por acá —
 * `src/__tests__/pestanasUnificadas.test.ts` lo fija.
 */
export type SegmentedVariant = 'control' | 'tabs';

export function Segmented<T extends string>({
  options, value, onChange, compact, variant = 'control', scroll, borde = 'abajo',
}: {
  /** `icon` sólo se dibuja en `tabs`; en `control` no hay lugar. */
  options: { key: T; label: string; icon?: keyof typeof Ionicons.glyphMap }[];
  value: T;
  onChange: (v: T) => void;
  compact?: boolean;
  variant?: SegmentedVariant;
  /**
   * Para cuando las opciones son muchas y de largo variable —los filtros por
   * grupo de Actividad—. Sin esto, N pestañas con `flex: 1` se aprietan hasta
   * que los nombres se cortan.
   */
  scroll?: boolean;
  /**
   * Sólo aplica a `variant="tabs"`. La "T invertida" nace con el trazo
   * horizontal ABAJO (default `'abajo'`, sin cambios). Grupos (T-108) la pega
   * al primer elemento de su lista — ahí el borde tiene que ir ARRIBA, si no
   * quedan dos líneas donde tiene que haber una (mismo criterio que
   * `Band noTop`). Actividad (T-108, agregado del PO) quiere las DOS
   * (`'ambos'`). Grupos (PO 2026-09-20, revierte el 'arriba' de T-108) no
   * quiere ninguna, ahora que el selector queda pegado a los casilleros de
   * arriba (`'ninguno'`). El resto de la app no pasa esta prop y no cambia.
   */
  borde?: 'abajo' | 'arriba' | 'ambos' | 'ninguno';
}) {
  const c = useC();
  const skin = useSkinTokens();

  // Aero (etapa 2): las pestañas pasan de «T invertida» de borde a borde a un
  // selector de píldora con margen; la activa, tarjeta blanca con sombra suave.
  if (variant === 'tabs' && skin.flags.soft) {
    const items = options.map(o => {
      const on = o.key === value;
      const color = on ? c.text : c.textTertiary;
      return (
        <Pressable
          key={o.key}
          accessibilityRole="tab"
          accessibilityState={{ selected: on }}
          onPress={() => onChange(o.key)}
          style={[
            scroll ? styles.pillItemScroll : styles.pillItem,
            compact && styles.pillItemCompact,
            on && { backgroundColor: c.surface, boxShadow: skin.elevation.e1.boxShadow },
          ]}
        >
          {o.icon ? <Ionicons name={o.icon} size={compact ? 14 : 16} color={color} /> : null}
          <Text numberOfLines={1} style={{ fontSize: compact ? 12 : 13.5, fontWeight: on ? '700' : '500', color }}>
            {o.label}
          </Text>
        </Pressable>
      );
    });
    const pista = [
      styles.pillWrap,
      { marginHorizontal: skin.space.inset, backgroundColor: c.surfaceSunken, borderColor: c.hair },
    ];
    return (
      <View testID="segmented-tabs-wrap" style={pista}>
        {scroll
          ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillScroll}>{items}</ScrollView>
          : items}
      </View>
    );
  }

  if (variant === 'tabs') {
    const items = options.map((o, i) => {
      const on = o.key === value;
      const color = on ? c.text : c.textTertiary;
      return (
        <Pressable
          key={o.key}
          accessibilityRole="tab"
          accessibilityState={{ selected: on }}
          onPress={() => onChange(o.key)}
          style={[
            scroll ? styles.tabsItemScroll : styles.tabsItem,
            // `compact`: un selector SECUNDARIO (p.ej. el sub-modo de porcentaje
            // debajo del modo de reparto, T-103.D) sigue siendo "T invertida" pero
            // más chico, para que la jerarquía entre el principal y el secundario
            // se lea sin salir del look unificado.
            compact && styles.tabsItemCompact,
            // El trazo vertical de la T, de alto completo para que toque la línea de abajo.
            // Fijas: entre celdas (a la izquierda de toda celda salvo la primera). En scroll:
            // a la derecha de CADA celda — si no, la última queda abierta y su fondo de
            // activa termina en el aire (se vio en Actividad con un solo filtro).
            scroll
              ? { borderRightWidth: 1, borderRightColor: c.hair }
              : i > 0 && { borderLeftWidth: 1, borderLeftColor: c.hair },
            { backgroundColor: on ? c.bgGrouped : 'transparent' },
          ]}
        >
          {o.icon ? <Ionicons name={o.icon} size={compact ? 14 : 16} color={color} /> : null}
          <Text numberOfLines={1} style={{ fontSize: compact ? 12 : 13.5, fontWeight: on ? '700' : '500', color }}>
            {o.label}
          </Text>
        </Pressable>
      );
    });

    const estiloBorde = borde === 'ambos'
      ? { borderTopWidth: 1, borderTopColor: c.hair, borderBottomColor: c.hair }
      : borde === 'arriba'
      ? { borderBottomWidth: 0, borderTopWidth: 1, borderTopColor: c.hair }
      : borde === 'ninguno'
      ? { borderTopWidth: 0, borderBottomWidth: 0 }
      : { borderTopWidth: 0, borderBottomColor: c.hair };

    if (scroll) {
      return (
        <View testID="segmented-tabs-wrap" style={[styles.tabsWrap, estiloBorde]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {items}
          </ScrollView>
        </View>
      );
    }
    return (
      <View testID="segmented-tabs-wrap" style={[styles.tabsWrap, estiloBorde]}>{items}</View>
    );
  }

  return (
    <View style={[styles.segWrap, { backgroundColor: c.hair2, borderRadius: compact ? 9 : 11 }]}>
      {options.map(o => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="button"
            onPress={() => onChange(o.key)}
            style={[
              compact ? styles.segTabCompact : styles.segTab,
              on && {
                backgroundColor: c.surface,
                boxShadow: '0 1px 2px rgba(20,25,20,0.12)',
              },
            ]}
          >
            <Text
              style={{
                fontSize: compact ? 11.5 : 13,
                fontWeight: on ? '700' : '500',
                color: on ? c.text : c.textTertiary,
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  segWrap: { flexDirection: 'row', padding: 4, gap: 4 },
  // Aero: pista redondeada con las pestañas como píldoras.
  pillWrap: {
    flexDirection: 'row', padding: 4, gap: 4, borderRadius: 18, borderWidth: 1,
    marginTop: Spacing[3], marginBottom: Spacing[1],
  },
  pillItem: {
    flex: 1, height: 40, borderRadius: 14, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 8,
  },
  pillItemCompact: { height: 32, gap: 5 },
  pillItemScroll: {
    height: 40, borderRadius: 14, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: Spacing[4],
  },
  pillScroll: { gap: 4 },
  // Variante `tabs` («T invertida»): de borde a borde, sin caja ni sombra. La línea de
  // abajo y los trazos verticales entre celdas son toda la estructura.
  tabsWrap: { flexDirection: 'row', borderBottomWidth: 1 },
  tabsItem: {
    flex: 1, height: 48, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 8,
  },
  tabsItemCompact: { height: 36, gap: 5 },
  // En scroll la celda se dimensiona a su contenido: `flex: 1` adentro de un
  // ScrollView horizontal colapsa a cero.
  tabsItemScroll: {
    height: 48, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: Spacing.screenPad,
  },
  segTab: {
    flex: 1, height: 32, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  segTabCompact: {
    paddingHorizontal: 11, paddingVertical: 6, borderRadius: 7,
    alignItems: 'center', justifyContent: 'center',
  },
});
