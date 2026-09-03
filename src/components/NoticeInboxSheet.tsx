import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { textFor } from '@/src/services/notifications';
import { esAccionable, msRestanteDeBorrado, type Notice } from '@/src/services/syncNotices';
import type { StoredNotice } from '@/src/store/noticeInboxStore';
import type { Expense } from '@/src/types/models';
import { BottomSheet } from './Sheet';
import { Segmented } from './Band';

/** Todo = la bandeja de siempre. Acción = sólo lo que pide algo (T-062). */
type Tab = 'todo' | 'accion';

type Trad = (key: string, opts?: Record<string, unknown>) => string;

/** "2 días" / "5 horas" / "40 minutos": basta para saber si hay que apurarse. */
function formatearRestante(ms: number, t: Trad): string {
  const horas = Math.floor(ms / 3_600_000);
  if (horas >= 24) return t('expense.time_days', { count: Math.floor(horas / 24) });
  if (horas >= 1)  return t('expense.time_hours', { count: horas });
  return t('expense.time_minutes', { count: Math.max(1, Math.floor(ms / 60_000)) });
}

/**
 * El cuerpo de una fila de `deletion`, mirado HOY (T-071).
 *
 * Distinto de `textFor`: ese texto es fijo porque se entrega como push en el
 * instante en que la ronda recién abrió — «72hs» es verdad en ESE momento.
 * Acá el aviso se lee después, capaz días después, así que el cuerpo dice lo
 * que falta DE VERDAD (`msRestanteDeBorrado`, que relee el gasto vivo) o,
 * si no hay nada que prometer, no promete nada.
 */
function cuerpoDeBorrado(
  notice: Extract<Notice, { kind: 'deletion' }>, expenses: Expense[], now: number, t: Trad,
): string {
  const restante = msRestanteDeBorrado(notice, expenses, now);
  return restante === null
    ? t('notifications.deletion_no_time', { description: notice.description })
    : t('notifications.deletion_remaining', {
        description: notice.description, time: formatearRestante(restante, t),
      });
}

/**
 * La bandeja: qué pasó mientras no mirabas.
 *
 * Tocar un aviso lo marca leído y lleva a su grupo. Marcar como leído NO borra:
 * el aviso queda en la lista, apagado. Borrarlo al leerlo haría que revisar la
 * bandeja destruyera la información que uno fue a buscar.
 */
export function NoticeInboxSheet({
  visible, items, expenses, now, onClose, onOpenNotice, onMarkAll,
}: {
  visible: boolean;
  items: StoredNotice[];
  /** Para releer el gasto vivo detrás de un aviso de `deletion` (T-071). */
  expenses: Expense[];
  /** Obligatorio, sin default — mismo criterio que `deletionRound` (T-059). */
  now: number;
  onClose: () => void;
  onOpenNotice: (item: StoredNotice) => void;
  onMarkAll: () => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { t } = useTranslation();
  const haySinLeer = items.some(i => i.readAt === null);

  const [tab, setTab] = useState<Tab>('todo');

  /**
   * La pestaña es de ESTA apertura, no del historial de la bandeja.
   *
   * Sin este reset, cerrar en «Acción» y volver a abrir dejaría a alguien
   * mirando la pestaña filtrada sin haberla elegido — y sin darse cuenta de
   * que la bandeja tiene más avisos de los que ve.
   */
  useEffect(() => { if (visible) setTab('todo'); }, [visible]);

  /**
   * ¿Esta fila suma en la pestaña Acción? (T-071)
   *
   * `deletion` es el ÚNICO kind donde leerlo no lo resuelve: el silencio
   * decide a las 72hs, así que cuenta mientras la ronda siga VIVA, esté leído
   * o no. Los demás kinds (settlement_pending, sync_down) siguen contando
   * por «sin leer», como en T-062 — ahí sí alcanza con mirarlo para que deje
   * de reclamar atención.
   */
  const cuentaEnAccion = (item: StoredNotice): boolean => {
    if (!esAccionable(item.notice.kind)) return false;
    if (item.notice.kind === 'deletion') return msRestanteDeBorrado(item.notice, expenses, now) !== null;
    return item.readAt === null;
  };
  const accionSinLeer = items.filter(cuentaEnAccion).length;
  const listaVisible = tab === 'accion' ? items.filter(i => esAccionable(i.notice.kind)) : items;

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.header}>
        <Text style={[Typography.bodyL, { color: c.text, fontWeight: '700', flex: 1 }]}>
          {t('notifications.inbox_title')}
        </Text>
        {haySinLeer && (
          <Pressable accessibilityRole="button" onPress={onMarkAll} hitSlop={6}>
            <Text style={[Typography.bodyS, { color: c.brand.primary, fontWeight: '600' }]}>
              {t('notifications.inbox_mark_all')}
            </Text>
          </Pressable>
        )}
      </View>

      {items.length === 0 ? (
        <View testID="inbox-empty" style={styles.vacio}>
          <Ionicons name="notifications-off-outline" size={26} color={c.textTertiary} />
          <Text style={[Typography.bodyM, { color: c.textSecondary, fontWeight: '600' }]}>
            {t('notifications.inbox_empty')}
          </Text>
          <Text style={[Typography.bodyS, { color: c.textTertiary, textAlign: 'center' }]}>
            {t('notifications.inbox_empty_hint')}
          </Text>
        </View>
      ) : (
        <>
          <Segmented
            variant="tabs"
            value={tab}
            onChange={setTab}
            options={[
              { key: 'todo', label: t('notifications.tab_all') },
              {
                key: 'accion',
                label: accionSinLeer > 0
                  ? t('notifications.tab_action_count', { count: accionSinLeer })
                  : t('notifications.tab_action'),
              },
            ]}
          />

          {tab === 'accion' && listaVisible.length === 0 ? (
            <View testID="inbox-empty-action" style={styles.vacio}>
              <Ionicons name="checkmark-done-outline" size={26} color={c.textTertiary} />
              <Text style={[Typography.bodyM, { color: c.textSecondary, fontWeight: '600' }]}>
                {t('notifications.inbox_empty_action')}
              </Text>
              <Text style={[Typography.bodyS, { color: c.textTertiary, textAlign: 'center' }]}>
                {t('notifications.inbox_empty_action_hint')}
              </Text>
            </View>
          ) : (
            <ScrollView style={styles.lista}>
              {listaVisible.map(item => {
                const { title, body } = item.notice.kind === 'deletion'
                  ? { title: item.notice.groupName, body: cuerpoDeBorrado(item.notice, expenses, now, t) }
                  : textFor(item.notice);
                const sinLeer = item.readAt === null;
                return (
                  <Pressable
                    key={item.id}
                    testID={`notice-${item.id}`}
                    accessibilityRole="button"
                    onPress={() => onOpenNotice(item)}
                    style={[styles.item, { backgroundColor: sinLeer ? c.brand.primarySoft : c.surfaceSunken }]}
                  >
                    <View style={[styles.punto, { backgroundColor: sinLeer ? c.brand.primary : 'transparent' }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[Typography.bodyM, {
                        color: sinLeer ? c.text : c.textSecondary,
                        fontWeight: sinLeer ? '700' : '500',
                      }]}>
                        {title}
                      </Text>
                      <Text style={[Typography.bodyS, { color: c.textTertiary }]}>{body}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={15} color={c.textTertiary} />
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], paddingBottom: Spacing[3] },
  vacio:  { alignItems: 'center', gap: Spacing[2], paddingVertical: Spacing[7] },
  lista:  { maxHeight: 380 },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing[3],
    padding: Spacing[3], borderRadius: Radius.sm, marginBottom: Spacing[2],
  },
  punto:  { width: 7, height: 7, borderRadius: 4 },
});
