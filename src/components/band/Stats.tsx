import React, { useContext } from 'react';
import { Text, View, type ViewStyle } from 'react-native';

import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { MontoRodante } from '@/src/components/MontoRodante';
import type { MontoRegistry } from '@/src/utils/montoRodanteRegistry';
import type { CurrencyCode } from '@/src/constants/currencies';
import { PanelContext } from '@/src/components/skin/PanelContext';
import { useSkinTokens } from '@/src/skins/useSkin';
import { StatCards } from '@/src/components/skin/StatCards';
import { Band, useC } from '@/src/components/band/BandBase';

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
  items, sunken, registry, noTop,
}: {
  items: StatItem[];
  sunken?: boolean;
  /** Sólo para tests: registro inyectable de `MontoRodante`. */
  registry?: MontoRegistry;
  /** Ver `Band`: pegado al bloque de encima, sin duplicar su línea divisoria. */
  noTop?: boolean;
}) {
  const c = useC();
  const soft = useSkinTokens().flags.soft;
  const panel = useContext(PanelContext);
  const centered = items.length > 2;
  // Aero (etapa 2): cifras como tarjetas sueltas (PO 2026-09-26).
  if (soft && !panel) return <StatCards rows={[items]} registry={registry} />;
  return (
    <Band sunken={sunken} noTop={noTop}>
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
  items, sunken, registry, noTop,
}: {
  items: [StatItem, StatItem, StatItem, StatItem];
  sunken?: boolean;
  /** Sólo para tests: registro inyectable de `MontoRodante`. */
  registry?: MontoRegistry;
  /** Ver `Band`: pegado al bloque de encima, sin duplicar su línea divisoria. */
  noTop?: boolean;
}) {
  const c = useC();
  const soft = useSkinTokens().flags.soft;
  const panel = useContext(PanelContext);

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

  if (soft && !panel) return <StatCards rows={[items.slice(0, 2), items.slice(2, 4)]} registry={registry} />;

  return (
    <Band sunken={sunken} noTop={noTop}>
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
  lead, leadRight, items, sunken, noTop,
}: {
  lead: StatItem;
  /** Indicador chico al lado del lead (PO 2026-09-20: cantidad de grupos junto a Ingreso). */
  leadRight?: StatItem;
  items: [StatItem, StatItem];
  sunken?: boolean;
  /** Ver `Band`: pegado al bloque de encima, sin duplicar su línea divisoria. */
  noTop?: boolean;
}) {
  const c = useC();
  const soft = useSkinTokens().flags.soft;
  const panel = useContext(PanelContext);

  const cuerpo = (it: StatItem, extra?: ViewStyle, testID?: string) => (
    <View
      key={it.label}
      testID={testID}
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

  if (soft && !panel) {
    return <StatCards rows={[leadRight ? [lead, leadRight] : [lead], items]} />;
  }

  return (
    <Band sunken={sunken} noTop={noTop}>
      <View style={{ flexDirection: 'row' }}>
        {cuerpo(lead, leadRight && { borderRightWidth: 1, borderRightColor: c.hair })}
        {leadRight && cuerpo(leadRight, undefined, 'stat-lead-right')}
      </View>
      <View style={{ flexDirection: 'row' }}>
        {cuerpo(items[0], { borderTopWidth: 1, borderTopColor: c.hair, borderRightWidth: 1, borderRightColor: c.hair })}
        {cuerpo(items[1], { borderTopWidth: 1, borderTopColor: c.hair })}
      </View>
    </Band>
  );
}
