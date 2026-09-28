import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { textFor } from '@/src/services/notifications';
import { esAccionable, type Notice } from '@/src/services/syncNotices';
import type { StoredNotice } from '@/src/store/noticeInboxStore';
import { useGroupStore } from '@/src/store/groupStore';
import { BottomSheet } from './Sheet';
import { Segmented } from './Band';
import { useColors } from '@/src/skins/useSkin';

/** Todo = la bandeja de siempre. Acción = sólo lo que pide algo (T-062). */
type Tab = 'todo' | 'accion';

type Trad = (key: string, opts?: Record<string, unknown>) => string;

// Referencia estable (T-205): cerrada, la bandeja no necesita `groups` —lo
// usa sólo `nombreGrupoNuevo`, al dibujar una fila `group_replaced`—.
// Devolver siempre esta misma instancia mientras `visible` es false evita
// que un alta de grupo en cualquier otra parte de la app re-renderice esto
// (y, con ello, el header que lo monta) sin que la bandeja esté ni abierta.
const SIN_GRUPOS: { id: string; name: string }[] = [];

/**
 * El cuerpo de una fila de `group_replaced`, resuelto AHORA y no con el
 * `newGroupName` congelado del aviso (Minor de la revisión final, upgraded a
 * fix-now).
 *
 * `newGroupName` se resuelve al MOMENTO de crear el aviso (`syncNotices.ts`),
 * pero clave y grupo llegan por canales independientes — no hay garantía de
 * que el grupo nuevo ya esté sincronizado localmente en ese instante. Como
 * los avisos de la bandeja son snapshots congelados que nunca se releen, un
 * nombre en blanco ahí no se autocorregía nunca. Acá sí: se relee
 * `useGroupStore` en cada render, así que en cuanto el grupo nuevo llega por
 * sync el nombre aparece solo, sin que el aviso se vuelva a generar.
 */
function nombreGrupoNuevo(
  notice: Extract<Notice, { kind: 'group_replaced' }>, groups: { id: string; name: string }[], t: Trad,
): string {
  return groups.find(g => g.id === notice.newGroupId)?.name
    || notice.newGroupName
    || t('groups.unnamed_group');
}

/**
 * La bandeja: qué pasó mientras no mirabas.
 *
 * Tocar un aviso lo marca leído y lleva a su grupo. Marcar como leído NO borra:
 * el aviso queda en la lista, apagado. Borrarlo al leerlo haría que revisar la
 * bandeja destruyera la información que uno fue a buscar.
 */
export function NoticeInboxSheet({
  visible, items, onClose, onOpenNotice, onMarkAll,
}: {
  visible: boolean;
  items: StoredNotice[];
  onClose: () => void;
  onOpenNotice: (item: StoredNotice) => void;
  onMarkAll: () => void;
}) {
  const c = useColors();
  const { t } = useTranslation();
  const groups = useGroupStore(s => (visible ? s.groups : SIN_GRUPOS));
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
   * ¿Esta fila suma en la pestaña Acción? (T-062)
   *
   * Los kinds accionables (settlement_pending, sync_down) cuentan por «sin
   * leer»: alcanza con mirarlos para que dejen de reclamar atención.
   */
  const cuentaEnAccion = (item: StoredNotice): boolean =>
    esAccionable(item.notice.kind) && item.readAt === null;
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
          {/* De borde a borde, como en el resto de la app: el margen negativo cancela el
              padding lateral del cuerpo de la hoja. */}
          <View style={styles.aLosBordes}>
            <Segmented
              variant="tabs"
              value={tab}
              onChange={setTab}
              options={[
                { key: 'todo', label: t('notifications.tab_all'), icon: 'list-outline' },
                {
                  key: 'accion',
                  label: accionSinLeer > 0
                    ? t('notifications.tab_action_count', { count: accionSinLeer })
                    : t('notifications.tab_action'),
                  icon: 'alert-circle-outline',
                },
              ]}
            />
          </View>

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
                const { title, body } = item.notice.kind === 'group_replaced'
                  ? {
                      title: t('notifications.group_replaced_title', { group: item.notice.groupName }),
                      body: t('notifications.group_replaced_body', {
                        newGroup: nombreGrupoNuevo(item.notice, groups, t),
                      }),
                    }
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
  aLosBordes: { marginHorizontal: -Spacing.screenPad, marginBottom: Spacing[3] },
  vacio:  { alignItems: 'center', gap: Spacing[2], paddingVertical: Spacing[7] },
  lista:  { maxHeight: 380 },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing[3],
    padding: Spacing[3], borderRadius: Radius.sm, marginBottom: Spacing[2],
  },
  punto:  { width: 7, height: 7, borderRadius: 4 },
});
