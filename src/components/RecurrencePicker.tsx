import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { hapticLight } from '@/src/utils/haptics';
import { Segmented } from '@/src/components/Band';
import type { RecurrenceRule } from '@/src/types/models';
import type { Ionicons } from '@expo/vector-icons';
import { useColors, useSkinTokens } from '@/src/skins/useSkin';

export type Frequency = RecurrenceRule['frequency'];

/** `null` = el gasto NO se repite. */
export type RecurrenceValue = Frequency | null;

/**
 * `Segmented` es genérico sobre `T extends string`: `null` no entra ahí, así
 * que "una vez" necesita una clave de string propia (`ONCE_KEY`) que se
 * traduce ida y vuelta con `RecurrenceValue` en las dos funciones de abajo.
 */
const ONCE_KEY = 'once' as const;
type RecurrenceKey = Frequency | typeof ONCE_KEY;

function toKey(v: RecurrenceValue): RecurrenceKey { return v === null ? ONCE_KEY : v; }
function toValue(k: RecurrenceKey): RecurrenceValue { return k === ONCE_KEY ? null : k; }

const OPTIONS: { key: RecurrenceKey; labelKey: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: ONCE_KEY,       labelKey: 'recurrence.once',        icon: 'close-circle-outline' },
  { key: 'weekly',       labelKey: 'recurrence.weekly',      icon: 'repeat-outline' },
  { key: 'fortnightly',  labelKey: 'recurrence.fortnightly', icon: 'repeat-outline' },
  { key: 'monthly',      labelKey: 'recurrence.monthly',     icon: 'calendar-outline' },
  { key: 'yearly',       labelKey: 'recurrence.yearly',      icon: 'calendar-number-outline' },
];

/**
 * Selector de repetición para el alta de un gasto.
 *
 * Se muestra siempre "Una vez" como opción explícita y por defecto: que el gasto
 * no se repita tiene que ser una elección visible, no la ausencia de una.
 *
 * **T-118 (PO 2026-09-13):** estilo "T invertida" (`Segmented variant="tabs"`),
 * en una sola fila deslizable en X (`scroll`) — el mismo modo que ya usan los
 * filtros de Actividad, no un wrap de chips propio.
 */
export function RecurrencePicker({
  value,
  onChange,
}: {
  value: RecurrenceValue;
  onChange: (v: RecurrenceValue) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const soft = useSkinTokens().flags.soft;

  const selector = (
    <Segmented
      variant="tabs"
      // Clásico: las pestañas quedan enmarcadas por la tarjeta, sin líneas
      // propias arriba/abajo (la tarjeta ya pone el borde). Aero: píldora con
      // margen, como siempre.
      borde={soft ? 'ambos' : 'ninguno'}
      scroll
      value={toKey(value)}
      onChange={k => { hapticLight(); onChange(toValue(k)); }}
      options={OPTIONS.map(o => ({ key: o.key, label: t(o.labelKey), icon: o.icon }))}
    />
  );

  // Aero ya dibuja el selector como píldora con margen: se deja como estaba.
  if (soft) {
    return (
      <View style={styles.wrap}>
        <Text style={[Typography.label, styles.pad, { color: c.textSecondary }]}>
          {t('recurrence.label')}
        </Text>
        {selector}
        {value !== null && (
          <Text style={[Typography.bodyS, styles.pad, { color: c.textTertiary }]}>
            {t('recurrence.hint')}
          </Text>
        )}
      </View>
    );
  }

  // Clásico (PO 2026-09-27): una tarjeta como la de la descripción, con margen
  // lateral y borde redondeado, en vez de pestañas sueltas de borde a borde
  // que rompían con el resto de la pantalla.
  return (
    <View style={[styles.card, { borderColor: c.hair, backgroundColor: c.surface }]}>
      <Text style={[Typography.label, styles.cardLabel, { color: c.textSecondary }]}>
        {t('recurrence.label')}
      </Text>
      <View style={[styles.cardSelector, { borderTopColor: c.hair }]}>
        {selector}
      </View>
      {value !== null && (
        <Text style={[Typography.bodyS, styles.cardHint, { color: c.textTertiary }]}>
          {t('recurrence.hint')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing[2] },
  pad:  { paddingHorizontal: Spacing.screenPad },
  // Mismo marco que `descCard` en `app/expense/new.tsx`.
  card: {
    marginHorizontal: Spacing.screenPad,
    borderRadius: Radius.xl, borderCurve: 'continuous', borderWidth: 1,
    overflow: 'hidden',
  },
  cardLabel:    { paddingHorizontal: Spacing[4], paddingTop: 12, paddingBottom: 8 },
  cardSelector: { borderTopWidth: 1 },
  cardHint:     { paddingHorizontal: Spacing[4], paddingVertical: 10 },
});
