import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatMoney } from '@/src/constants/currencies';
import { isMarked, type TrustState } from '@/src/algorithms/recordTrust';
import { TrustMark } from '@/src/components/TrustMark';
import { ActivityLine } from '@/src/components/ActivityLine';
import { mismaPersona } from '@/src/store/identityAlias';
import { PERSONAL_ACTIVITY_KEY, type ActivityKind } from '@/src/store/selectors';
import { relativeTime, miParteDelGasto } from '@/src/screens/activity/utils/activityFormat';

/**
 * Fila de evento. En el reskin todas las variantes comparten la MISMA caja
 * (fila de banda con hairline): lo que cambia es el ícono teñido, el color del
 * monto y, en el pedido de borrado, el fondo de advertencia.
 *
 * Memoizada (PO 2026-09-22, rendimiento en gama baja): sólo sirve porque
 * `onRestore`/`getUserName` llegan como referencias ESTABLES desde
 * `ActivityScreen`, no inline — mismo patrón que `GroupRow`/`ContactRow`/
 * `EntryRow`. `trust` y `event` son valores nuevos por render de todos modos
 * (recalculados a partir del feed), así que esto no elimina el trabajo del
 * padre — sólo evita reconstruir el árbol de ESTA fila cuando nada de lo
 * suyo cambió.
 */
export const EventRow = React.memo(function EventRow({
  event, trust, getUserName, currentUserId, onRestore, last,
}: {
  event: ActivityKind;
  trust: TrustState;
  onRestore: (expenseId: string) => void;
  getUserName: (id: string) => string;
  currentUserId: string;
  last?: boolean;
}) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  // El `groupName` de un movimiento sin grupo es el sentinel `PERSONAL_ACTIVITY_KEY`
  // (T-116) — hace falta para el FILTRO, pero mostrárselo crudo al usuario
  // ("· __personal__") sería un bug de UI, no una traducción faltante.
  const nombreDeGrupo = (groupName: string) =>
    groupName === PERSONAL_ACTIVITY_KEY ? t('activity.filter_personal') : groupName;

  const marca = isMarked(trust)
    ? <TrustMark label={t('trust.badge')} size="sm" testID={`trust-${event.kind}`} />
    : null;

  const row = (opts: {
    icon: keyof typeof Ionicons.glyphMap;
    tint: string;
    bg: string;
    body: React.ReactNode;
    right?: React.ReactNode;
    warn?: boolean;
    onPress?: () => void;
  }) => {
    /**
     * **`View` no acepta una función como `style`; `Pressable` sí.**
     *
     * Estaban compartiendo un `Container: any` con un `style={({pressed}) =>
     * [...]}`, así que toda fila SIN `onPress` —pedido de borrado, pago,
     * borrado— se renderizaba con la función ignorada y por lo tanto **sin un
     * solo estilo**: sin `flexDirection: row`, sin padding, sin borde y sin
     * gap. El ícono quedaba arriba y el texto pegado al borde izquierdo. El
     * `any` del Container es lo que impidió que TypeScript lo dijera.
     *
     * Ahora las dos ramas son explícitas y el array base se arma una sola vez.
     */
    const base = [
      styles.row,
      {
        borderBottomWidth: last ? 0 : 1,
        // `hair` y no `hair2`: el divisor tenue está calibrado para filas de
        // una línea, y estas llevan dos más el timestamp. A esa altura el
        // 5,5% se pierde y las filas se leen como una sola.
        borderBottomColor: c.hair,
        backgroundColor: opts.warn ? c.semantic.warningSoft : 'transparent',
      },
    ];

    const contenido = (
      <>
        <View style={[styles.rowIcon, { backgroundColor: opts.bg }]}>
          <Ionicons name={opts.icon} size={16} color={opts.tint} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          {opts.body}
          {marca}
        </View>
        {opts.right}
      </>
    );

    if (!opts.onPress) {
      return <View testID="activity-row" style={base}>{contenido}</View>;
    }

    return (
      <Pressable
        testID="activity-row"
        onPress={opts.onPress}
        style={({ pressed }) => [...base, pressed && { backgroundColor: c.bgGrouped }]}
      >
        {contenido}
      </Pressable>
    );
  };

  if (event.kind === 'expense_added') {
    const { expense, groupName } = event;
    const isMe   = mismaPersona(expense.paidById, currentUserId);
    const who    = isMe ? t('common.you') : getUserName(expense.paidById);
    const action = isMe ? t('activity.action_registered_own') : t('activity.action_registered_other');
    // Sólo tiene sentido en gastos DE GRUPO: un gasto personal no tiene a
    // nadie más de quien depender, así que no hay "te deben"/"debés" que
    // mostrar (T-137).
    const miParte = groupName !== PERSONAL_ACTIVITY_KEY
      ? miParteDelGasto(expense, currentUserId)
      : null;
    return row({
      icon: 'add-outline', tint: c.brand.primary, bg: c.brand.primarySoft,
      onPress: () => router.push(`/expense/${expense.id}` as any),
      body: <ActivityLine who={who} action={action} subject={`${expense.description} · ${nombreDeGrupo(groupName)}`} ts={relativeTime(expense.date)} />,
      right: (
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Text style={[Typography.amountS, { color: c.text }]}>
            {formatMoney(expense.amount, expense.currency)}
          </Text>
          {miParte !== null && (
            <Text
              testID="activity-mi-parte"
              style={[
                Typography.caption,
                { fontWeight: '700', color: miParte > 0 ? c.semantic.positive : c.semantic.negative },
              ]}
            >
              {miParte > 0 ? '+' : '-'}{formatMoney(miParte, expense.currency)}
            </Text>
          )}
        </View>
      ),
    });
  }

  if (event.kind === 'expense_delete_request') {
    const { expense, groupName, requestedByName } = event;
    return row({
      icon: 'warning-outline', tint: c.semantic.warning, bg: c.semantic.warningSoft, warn: true,
      body: (
        <ActivityLine
          who={requestedByName}
          action={t('activity.action_requested_delete')}
          subject={`“${expense.description}” · ${nombreDeGrupo(groupName)}`}
          ts={relativeTime(expense.deletionVotes?.[0]?.votedAt ?? expense.date)}
        />
      ),
    });
  }

  if (event.kind === 'expense_deleted') {
    const { expense, groupName } = event;
    return row({
      icon: 'trash-outline', tint: c.textTertiary, bg: c.hair2,
      body: (
        <>
          <Text
            style={[Typography.bodyM, { color: c.textSecondary, textDecorationLine: 'line-through' }]}
            numberOfLines={1}
          >
            {t('activity.deleted_title', { desc: expense.description })}
          </Text>
          <Text style={[Typography.caption, { color: c.textTertiary, marginTop: 2 }]}>
            {nombreDeGrupo(groupName)} · {relativeTime(expense.updatedAt || expense.date)}
          </Text>
        </>
      ),
      right: (
        <Pressable
          testID={`restore-${expense.id}`}
          accessibilityRole="button"
          onPress={() => onRestore(expense.id)}
          hitSlop={8}
        >
          <Text style={{ fontSize: 11.5, fontWeight: '700', color: c.brand.primary }}>
            {t('activity.restore')}
          </Text>
        </Pressable>
      ),
    });
  }

  if (event.kind === 'expense_restored') {
    const { expense, groupName, restoredByName } = event;
    return row({
      icon: 'arrow-undo-outline', tint: c.textTertiary, bg: c.hair2,
      body: (
        <ActivityLine
          who={restoredByName}
          action={t('activity.action_restored')}
          subject={`“${expense.description}” · ${nombreDeGrupo(groupName)}`}
          ts={relativeTime(expense.updatedAt || expense.date)}
        />
      ),
    });
  }

  if (event.kind === 'personal_entry') {
    const { entry } = event;
    const isIncome = entry.kind === 'income';
    // Mismo verbo que un gasto de grupo propio ("registraste"): el ícono y el
    // color ya distinguen ingreso de gasto, no hace falta un verbo aparte.
    return row({
      icon: isIncome ? 'trending-up-outline' : 'trending-down-outline',
      tint: isIncome ? c.brand.primary : c.textSecondary,
      bg: isIncome ? c.brand.primarySoft : c.hair2,
      // Sin `onPress`: a diferencia de un gasto de grupo, un `PersonalEntry`
      // no tiene pantalla de detalle propia — se edita desde la tab Personal.
      body: <ActivityLine who={t('common.you')} action={t('activity.action_registered_own')} subject={entry.description} ts={relativeTime(entry.date)} />,
      right: (
        <Text style={[Typography.amountS, { color: isIncome ? c.semantic.positive : c.text }]}>
          {formatMoney(entry.amount, entry.currency)}
        </Text>
      ),
    });
  }

  const { payment, groupName } = event;
  const isMe   = mismaPersona(payment.fromUserId, currentUserId);
  const who    = isMe ? t('common.you') : getUserName(payment.fromUserId);
  const toName = getUserName(payment.toUserId);
  return row({
    icon: 'arrow-forward-outline', tint: c.semantic.positive, bg: c.semantic.positiveSoft,
    body: (
      <>
        <Text style={[Typography.bodyM, { color: c.textSecondary, lineHeight: 20 }]}>
          <Text style={{ fontWeight: '700', color: c.text }}>{who}</Text>
          {` ${t('activity.action_paid')} `}
          <Text style={{ fontWeight: '700', color: c.text }}>{toName}</Text>
          <Text> · {nombreDeGrupo(groupName)}</Text>
        </Text>
        <Text style={[Typography.caption, { color: c.textTertiary, marginTop: 2 }]}>
          {relativeTime(payment.date)}
        </Text>
      </>
    ),
    right: (
      <Text style={[Typography.amountS, { color: c.semantic.positive }]}>
        {formatMoney(payment.amount, payment.currency)}
      </Text>
    ),
  });
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', gap: 13, alignItems: 'flex-start',
    paddingHorizontal: Spacing.screenPad, paddingVertical: 13,
  },
  rowIcon: {
    width: 32, height: 32, borderRadius: Radius.sm,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
});
