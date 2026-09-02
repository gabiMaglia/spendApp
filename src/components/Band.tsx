import React from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle, ScrollView } from 'react-native';

import { Colors } from '@/src/constants/colors';
import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * Primitivas del reskin "flat bands".
 *
 * La tarjeta flotante desaparece: un bloque es una BANDA de ancho completo con
 * hairline arriba y abajo, y sus filas se separan con un hairline más suave.
 * El padding horizontal vive en la FILA, no en la banda, así el divisor llega
 * de borde a borde.
 */

export function useC() {
  const scheme = useColorScheme() ?? 'light';
  return Colors[scheme];
}

/** Etiqueta de sección sobre una banda. `right` es un link o accesorio opcional. */
export function SectionLabel({
  label, right, first,
}: { label: string; right?: React.ReactNode; first?: boolean }) {
  const c = useC();
  return (
    <View style={[styles.sectionLabel, first && { paddingTop: Spacing[2] }]}>
      <Text style={[Typography.label, { color: c.textTertiary, textTransform: 'uppercase' }]}>
        {label}
      </Text>
      {right}
    </View>
  );
}

/** Link de texto a la derecha de una etiqueta de sección. */
export function BandLink({ label, onPress }: { label: string; onPress: () => void }) {
  const c = useC();
  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <Text style={{ fontSize: 11.5, fontWeight: '600', color: c.brand.primary }}>{label}</Text>
    </Pressable>
  );
}

/** Banda de ancho completo. `sunken` para el tono hundido (fila de neto, chips). */
export function Band({
  children, sunken, style, noBottom,
}: { children: React.ReactNode; sunken?: boolean; style?: ViewStyle; noBottom?: boolean }) {
  const c = useC();
  return (
    <View
      style={[
        {
          backgroundColor: sunken ? c.bgGrouped : c.surface,
          borderTopWidth: 1,
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
  children, onPress, last, style,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  last?: boolean;
  style?: ViewStyle;
}) {
  const c = useC();
  const base: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: Spacing.screenPad,
    paddingVertical: Spacing.rowPadV,
    borderBottomWidth: last ? 0 : 1,
    borderBottomColor: c.hair2,
  };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [base, pressed && { backgroundColor: c.bgGrouped }, style]}
    >
      {children}
    </Pressable>
  );
}

/**
 * Banda de estadísticas partida por divisores verticales.
 * 2 columnas = alineadas a la izquierda; 3 o más = centradas.
 */
export type StatItem = { label: string; value: string; color?: string };

export function SplitStat({
  items, sunken,
}: {
  items: StatItem[];
  sunken?: boolean;
}) {
  const c = useC();
  const centered = items.length > 2;
  return (
    <Band sunken={sunken}>
      <View style={{ flexDirection: 'row' }}>
        {items.map((it, i) => (
          <React.Fragment key={it.label}>
            {i > 0 && <View style={{ width: 1, backgroundColor: c.hair }} />}
            <View
              style={{
                flex: 1,
                paddingVertical: Spacing[4],
                paddingHorizontal: centered ? Spacing[3] : Spacing.screenPad,
                alignItems: centered ? 'center' : 'flex-start',
              }}
            >
              <Text style={[Typography.label, { color: c.textTertiary, textTransform: 'uppercase' }]}>
                {it.label}
              </Text>
              <Text style={[Typography.amountM, { color: it.color ?? c.text }]}>{it.value}</Text>
            </View>
          </React.Fragment>
        ))}
      </View>
    </Band>
  );
}

/**
 * **Cuatro indicadores en grilla 2×2** (PO 2026-09-02).
 *
 * `SplitStat` reparte N celdas en UNA fila: con cuatro, cada una queda de un
 * cuarto de ancho y los montos con miles no entran — se cortan o bajan de
 * cuerpo hasta ser ilegibles. La grilla les da la mitad del ancho a cada una y
 * mantiene el mismo lenguaje: etiqueta chica en versalitas, número grande,
 * hairlines separando.
 *
 * Toma exactamente cuatro porque la grilla es 2×2 y un hueco vacío se ve como
 * un error. Si algún día hacen falta seis, es otro componente.
 */
export function StatGrid({
  items, sunken,
}: {
  items: [StatItem, StatItem, StatItem, StatItem];
  sunken?: boolean;
}) {
  const c = useC();

  const celda = (it: StatItem, i: number) => (
    <View
      key={it.label}
      style={{
        flex: 1,
        paddingVertical: Spacing[4],
        paddingHorizontal: Spacing.screenPad,
        // Sin el borde derecho en la segunda columna: cerraría la banda por
        // adentro y se leería como una tabla, no como un bloque.
        borderRightWidth: i % 2 === 0 ? 1 : 0,
        borderRightColor: c.hair,
        // Y sin el de arriba en la primera fila, por lo mismo.
        borderTopWidth: i > 1 ? 1 : 0,
        borderTopColor: c.hair,
      }}
    >
      <Text style={[Typography.label, { color: c.textTertiary, textTransform: 'uppercase' }]}>
        {it.label}
      </Text>
      <Text
        style={[Typography.amountM, { color: it.color ?? c.text }]}
        numberOfLines={1}
        // Un monto largo se achica antes que cortarse: en plata, «$12.4…» no
        // es un número más chico, es un número que no se puede leer.
        adjustsFontSizeToFit
        minimumFontScale={0.75}
      >
        {it.value}
      </Text>
    </View>
  );

  return (
    <Band sunken={sunken}>
      <View style={{ flexDirection: 'row' }}>{items.slice(0, 2).map(celda)}</View>
      <View style={{ flexDirection: 'row' }}>{items.slice(2, 4).map((it, i) => celda(it, i + 2))}</View>
    </Band>
  );
}

/**
 * **Un indicador principal a lo ancho, y dos abajo** (PO 2026-09-02).
 *
 * Es la forma de un total con su desglose: el de arriba es de otra naturaleza
 * que los dos de abajo —un ingreso contra dos gastos— y ponerlos en la misma
 * fila los hace parecer comparables entre sí. A lo ancho, el primero se lee
 * como el encabezado de los otros dos.
 */
export function StatLead({
  lead, items, sunken,
}: {
  lead: StatItem;
  items: [StatItem, StatItem];
  sunken?: boolean;
}) {
  const c = useC();

  const cuerpo = (it: StatItem, extra?: ViewStyle) => (
    <View
      key={it.label}
      style={[
        { flex: 1, paddingVertical: Spacing[4], paddingHorizontal: Spacing.screenPad },
        extra,
      ]}
    >
      <Text style={[Typography.label, { color: c.textTertiary, textTransform: 'uppercase' }]}>
        {it.label}
      </Text>
      <Text
        style={[Typography.amountM, { color: it.color ?? c.text }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
      >
        {it.value}
      </Text>
    </View>
  );

  return (
    <Band sunken={sunken}>
      {cuerpo(lead)}
      <View style={{ flexDirection: 'row' }}>
        {cuerpo(items[0], { borderTopWidth: 1, borderTopColor: c.hair, borderRightWidth: 1, borderRightColor: c.hair })}
        {cuerpo(items[1], { borderTopWidth: 1, borderTopColor: c.hair })}
      </View>
    </Band>
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

/** Control segmentado (Activos/Archivados, Tema, Idioma). */
/**
 * `control` — la pastilla, para elegir DENTRO de un formulario (cómo dividir un
 * gasto, qué tema). `tabs` — plano, para separar el contenido de una PANTALLA
 * (Activos/Archivados, los filtros de Actividad).
 *
 * Son dos trabajos distintos y por eso son dos looks. Una pastilla con sombra a
 * nivel de página compite con el contenido y contradice el reskin plano; un
 * subrayado adentro de un formulario no se lee como algo que se toca.
 */
export type SegmentedVariant = 'control' | 'tabs';

export function Segmented<T extends string>({
  options, value, onChange, compact, variant = 'control', scroll,
}: {
  options: { key: T; label: string }[];
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
}) {
  const c = useC();

  if (variant === 'tabs') {
    const items = options.map(o => {
      const on = o.key === value;
      return (
        <Pressable
          key={o.key}
          accessibilityRole="tab"
          accessibilityState={{ selected: on }}
          onPress={() => onChange(o.key)}
          style={scroll ? styles.tabsItemScroll : styles.tabsItem}
        >
          <Text
            numberOfLines={1}
            style={{
              fontSize: 13.5,
              fontWeight: on ? '700' : '500',
              color: on ? c.brand.primary : c.textTertiary,
            }}
          >
            {o.label}
          </Text>
          {/* La barra se dibuja SIEMPRE, transparente cuando no está activa:
              si sólo existiera en la activa, el texto saltaría 2pt al cambiar
              de pestaña. */}
          <View
            style={[
              styles.tabsBar,
              { backgroundColor: on ? c.brand.primary : 'transparent' },
            ]}
          />
        </Pressable>
      );
    });

    if (scroll) {
      return (
        <View style={[styles.tabsWrap, { borderBottomColor: c.hair }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabsScrollContent}
          >
            {items}
          </ScrollView>
        </View>
      );
    }

    return <View style={[styles.tabsWrap, { borderBottomColor: c.hair }]}>{items}</View>;
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
  segWrap: { flexDirection: 'row', padding: 4, gap: 4 },
  // Variante `tabs`: sin caja, sin sombra. La hairline de abajo es lo que la
  // hace leer como una barra de pestañas y no como dos textos sueltos.
  tabsWrap: { flexDirection: 'row', borderBottomWidth: 1 },
  tabsItem: { flex: 1, alignItems: 'center', gap: 7, paddingTop: 10 },
  // En scroll el ítem se dimensiona a su texto: `flex: 1` adentro de un
  // ScrollView horizontal colapsa a cero.
  tabsItemScroll: { alignItems: 'center', gap: 7, paddingTop: 10, paddingHorizontal: 4 },
  tabsScrollContent: { paddingHorizontal: Spacing.screenPad - 4, gap: 14 },
  tabsBar:  { height: 2, alignSelf: 'stretch', marginHorizontal: 12, borderRadius: 1 },
  segTab: {
    flex: 1, height: 32, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  segTabCompact: {
    paddingHorizontal: 11, paddingVertical: 6, borderRadius: 7,
    alignItems: 'center', justifyContent: 'center',
  },
});
