import React from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/src/constants/colors';
import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MontoRodante } from '@/src/components/MontoRodante';
import type { MontoRegistry } from '@/src/utils/montoRodanteRegistry';
import type { CurrencyCode } from '@/src/constants/currencies';

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
  children, sunken, style, noBottom, noTop,
}: {
  children: React.ReactNode; sunken?: boolean; style?: ViewStyle; noBottom?: boolean;
  /**
   * Sin línea de arriba: la banda va PEGADA al bloque de encima y comparte su línea
   * divisoria (PO, 2026-09-12 — el input de descripción de un gasto). Con las dos líneas
   * se verían 2pt donde tiene que haber una.
   */
  noTop?: boolean;
}) {
  const c = useC();
  return (
    <View
      style={[
        {
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
  children, onPress, last, style, accessibilityRole,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  last?: boolean;
  style?: ViewStyle;
  /** Para filas que son una acción (p. ej. «Eliminar gasto», T-107). */
  accessibilityRole?: 'button' | 'link';
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
      accessibilityRole={accessibilityRole}
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
export type StatItem = {
  label: string;
  /** Texto YA formateado — el que se ve sin `id`, y la referencia exacta que valida `MontoRodante` con `id`. */
  value: string;
  color?: string;
  /**
   * Sólo para los MONTOS-RESUMEN de bloque (T-106): con `id`, el valor rueda
   * (`MontoRodante`) en vez de aparecer directo. Sin `id` (default), es el
   * mismo `<Text>` de siempre — ningún consumidor existente cambia.
   * Requiere `minor` (y `code` si es un monto de moneda; omitir `code` para
   * un conteo simple, ej. "cantidad de grupos").
   */
  id?: string;
  minor?: number;
  code?: CurrencyCode;
  /**
   * T-109: hay una conversión de moneda en curso para ESTE monto — se
   * muestra `--` en vez de animar hacia un total parcial. Sólo tiene efecto
   * junto con `id`. Ver `MontoRodante.pending`.
   */
  pending?: boolean;
  /** Texto ya traducido (`t('fx.calculating')`) para el placeholder de `pending`. */
  pendingLabel?: string;
};

export function SplitStat({
  items, sunken, registry,
}: {
  items: StatItem[];
  sunken?: boolean;
  /** Sólo para tests: registro inyectable de `MontoRodante`. */
  registry?: MontoRegistry;
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
              {it.id ? (
                <MontoRodante
                  id={it.id}
                  minor={it.minor ?? 0}
                  code={it.code}
                  style={[Typography.amountM, { color: it.color ?? c.text }]}
                  registry={registry}
                  pending={it.pending}
                  pendingAccessibilityLabel={it.pendingLabel}
                />
              ) : (
                <Text style={[Typography.amountM, { color: it.color ?? c.text }]}>{it.value}</Text>
              )}
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
  items, sunken, registry,
}: {
  items: [StatItem, StatItem, StatItem, StatItem];
  sunken?: boolean;
  /** Sólo para tests: registro inyectable de `MontoRodante`. */
  registry?: MontoRegistry;
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
      {it.id ? (
        <MontoRodante
          id={it.id}
          minor={it.minor ?? 0}
          code={it.code}
          style={[Typography.amountM, { color: it.color ?? c.text }]}
          registry={registry}
          pending={it.pending}
          pendingAccessibilityLabel={it.pendingLabel}
        />
      ) : (
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
      )}
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
   * (`'ambos'`). El resto de la app no pasa esta prop y no cambia.
   */
  borde?: 'abajo' | 'arriba' | 'ambos';
}) {
  const c = useC();

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
