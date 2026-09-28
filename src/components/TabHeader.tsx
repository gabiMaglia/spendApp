import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SharedValue } from 'react-native-reanimated';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { CollapsibleHeader, HeaderCurrency } from './CollapsibleHeader';
import { NoticeBell } from './NoticeBell';
import { NoticeInboxSheet } from './NoticeInboxSheet';
import { GroupKeyConflictCard } from './GroupKeyConflictCard';
import { BottomSheet } from './Sheet';
import { CurrencySheet } from './CurrencyPicker';
import { UserAvatar } from './UserAvatar';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useSettingsStore } from '@/src/store/settingsStore';
import {
  useNoticeInboxStore, useUnreadNoticeCount, type StoredNotice,
} from '@/src/store/noticeInboxStore';
import { esAccionable, type KeyConflictNotice } from '@/src/services/syncNotices';
import { ofertasDe } from '@/src/sync/invitaciones/groupKeyOffers';
import { hapticLight } from '@/src/utils/haptics';
import { useColors } from '@/src/skins/useSkin';
import { useContadorDeRenders } from '@/src/hooks/useContadorDeRenders';

/**
 * **El header de las seis tabs. Uno solo, con lo mismo en todas.**
 *
 * Antes cada tab lo armaba a mano y ninguna coincidía: el dashboard tenía la
 * campana y el selector de moneda, Actividad no tenía ninguno de los dos,
 * Perfil no tenía ni avatar, y las tres restantes tenían moneda pero no
 * campana. La bandeja de avisos existía en UNA pantalla — o sea que enterarse
 * de algo dependía de en qué tab estabas parado.
 *
 * Los elementos y su orden son decisión del PO (2026-09-02, ajustado 2026-09-22):
 * **avatar con la foto de perfil, campana de notificaciones, engranaje de
 * ajustes y selector de moneda maestra.**
 *
 * El avatar es `UserAvatar` y no `HeaderAvatar`: aquél resuelve la FOTO y cae a
 * las iniciales solo si no hay. `HeaderAvatar` dibujaba iniciales siempre, que
 * es lo que el PO vino a corregir.
 *
 * **El engranaje es ahora el único camino a «Yo»** (PO 2026-09-22): antes era
 * la foto (T-115), y el engranaje —sólo en Personal— abría el presupuesto
 * directo. La foto deja de navegar (por ahora) pero conserva el anillo de
 * marca; el engranaje está en las cuatro tabs y siempre lleva a «Yo». Editar
 * el presupuesto ya armado vive ahora en «Yo» (`BudgetSheet`); acá sólo queda
 * la navegación.
 *
 * Las dos hojas —bandeja y monedas— viven acá adentro. Es lo que hace que esto
 * sea un componente y no un objeto de props: si cada tab tuviera que montarlas,
 * la próxima tab nueva se olvidaría de una y nadie lo notaría hasta que a
 * alguien no le llegue un aviso.
 */
export function TabHeader({
  title, subtitle, progress,
}: {
  title: string;
  /** Sólo Inicio lo pasa hoy: "Hola, {nombre}" arriba del título (T-114). */
  subtitle?: string;
  /** Progreso de colapso en [0,1] — de `useHeaderColapsable` (T-128). */
  progress: SharedValue<number>;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const currentUser = useAuthStore(s => s.currentUser);
  const cur         = useSettingsStore(s => s.displayCurrency);
  const setCurrency = useSettingsStore(s => s.setDisplayCurrency);

  const sinLeer     = useUnreadNoticeCount();
  const markRead      = useNoticeInboxStore(s => s.markRead);
  const markAllRead   = useNoticeInboxStore(s => s.markAllRead);
  const markReadWhere = useNoticeInboxStore(s => s.markReadWhere);

  const [bandeja, setBandeja] = useState(false);
  const [monedas, setMonedas] = useState(false);
  /** Aviso de claves en disputa abierto (T-136): el id para marcarlo leído al resolver. */
  const [conflicto, setConflicto] = useState<{ id: string; notice: KeyConflictNotice } | null>(null);

  useContadorDeRenders('TabHeader', { title, currentUser, cur, sinLeer });

  /**
   * **Abrir la campana marca leídas las que NO piden acción** (PO 2026-09-13,
   * T-119). Las accionables (`esAccionable`: `settlement_pending`,
   * `sync_down`) siguen pendientes — abrirlas no las resuelve, hace falta
   * actuar (acusar recibo/reintentar). El botón "Marcar todo" de la
   * bandeja sigue siendo la vía explícita para apagar TODO, accionables
   * incluidas — este auto-marcado no lo reemplaza.
   */
  function abrirCampana() {
    markReadWhere(item => !esAccionable(item.notice.kind));
    setBandeja(true);
  }

  function abrirAviso(item: StoredNotice) {
    // La constante es necesaria para que TypeScript estreche el union: sobre
    // `item.notice` el `in` no acota nada.
    const aviso = item.notice;

    /**
     * T-136: leer este aviso no lo resuelve — hay que elegir una clave. Se abre
     * la tarjeta y queda sin leer hasta que la elección salga bien. Si ya no
     * quedan dos ofertas, el conflicto se resolvió por otro lado: se marca
     * leído y no se abre nada.
     */
    if (aviso.kind === 'group_key_conflict') {
      setBandeja(false);
      if (ofertasDe(aviso.groupId).length < 2) { markRead(item.id); return; }
      setConflicto({ id: item.id, notice: aviso });
      return;
    }

    /**
     * `group_replaced` navega al grupo NUEVO, no al viejo: el viejo quedó
     * archivado de solo lectura y `aviso.groupId` apunta justo a él. Tiene
     * que ir antes de la navegación genérica por `groupId` de más abajo, que
     * si no lo intercepta manda al lector adentro del grupo que ya no sirve.
     */
    if (aviso.kind === 'group_replaced') {
      markRead(item.id);
      setBandeja(false);
      // T-205: sin selector — se lee `getState()` al momento del toque, no
      // hace falta que el header entero se re-renderice cada vez que un
      // grupo cambia en cualquier parte de la app.
      const grupoNuevo = useGroupStore.getState().groups.find(g => g.id === aviso.newGroupId && !g.isDeleted);
      if (!grupoNuevo) { alert(t('notifications.inbox_gone')); return; }
      router.push(`/groups/${grupoNuevo.id}` as never);
      return;
    }

    markRead(item.id);
    setBandeja(false);

    // No todo aviso es de un grupo: el del reloj (T-038) es del aparato. Se
    // marca leído y no se navega a ningún lado, que es lo correcto — no hay
    // pantalla adentro de la app donde arreglar la hora del teléfono.
    if (!('groupId' in aviso)) return;

    const grupo = useGroupStore.getState().groups.find(g => g.id === aviso.groupId && !g.isDeleted);
    // El grupo pudo borrarse entre que llegó el aviso y que lo tocaron. Sin
    // esto la navegación deja una pantalla de detalle vacía sin explicación.
    if (!grupo) { alert(t('notifications.inbox_gone')); return; }
    router.push(`/groups/${grupo.id}` as never);
  }

  return (
    <>
      <CollapsibleHeader
        title={title}
        subtitle={subtitle}
        progress={progress}
        left={
          // T-115/PO 2026-09-22: la foto deja de navegar (ese rol pasó al
          // engranaje) — se conserva sólo el anillo de marca como identidad,
          // ya no es un botón.
          <View testID="header-profile">
            <UserAvatar
              userId={currentUser?.id ?? ''}
              name={currentUser?.name}
              size={32}
              ring={c.brand.primary}
            />
          </View>
        }
        right={
          <>
            <NoticeBell unread={sinLeer} onPress={abrirCampana} />
            <Pressable
              testID="header-settings-btn"
              onPress={() => { hapticLight(); router.push('/(tabs)/user' as never); }}
              accessibilityRole="button"
              accessibilityLabel={t('dashboard.go_to_profile')}
              hitSlop={8}
            >
              <Ionicons name="settings-outline" size={20} color={c.textSecondary} />
            </Pressable>
            <HeaderCurrency code={cur} onPress={() => setMonedas(true)} />
          </>
        }
      />

      <CurrencySheet
        visible={monedas}
        value={cur}
        onChange={setCurrency}
        onClose={() => setMonedas(false)}
      />
      <NoticeInboxConnected
        visible={bandeja}
        onClose={() => setBandeja(false)}
        onOpenNotice={abrirAviso}
        onMarkAll={() => markAllRead()}
      />
      {conflicto && (
        <BottomSheet visible onClose={() => setConflicto(null)}>
          <GroupKeyConflictCard
            notice={conflicto.notice}
            senderIds={ofertasDe(conflicto.notice.groupId).map(o => o.fromUserId)}
            onResuelto={() => { markRead(conflicto.id); setConflicto(null); }}
            onDespues={() => setConflicto(null)}
          />
        </BottomSheet>
      )}
    </>
  );
}

// Referencia estable: cerrada, la bandeja no necesita `items`. Devolver
// siempre esta misma instancia mientras `visible` es false evita que un
// aviso nuevo en cualquier parte de la app re-renderice este puente — y, con
// él, las seis tabs que montan `TabHeader`.
const SIN_ITEMS: StoredNotice[] = [];

/**
 * Puente entre `TabHeader` y `NoticeInboxSheet` (T-205).
 *
 * `NoticeInboxSheet` recibe `items` como prop —así lo prueba su propio test
 * unitario (`NoticeInbox.test.tsx`), y ese contrato no cambia acá. Lo que
 * cambia es QUIÉN se suscribe a `useNoticeInboxStore`: antes era `TabHeader`
 * (suscripción a TODO `items`, sin relación con si la bandeja estaba
 * abierta); ahora es este componente aparte, que sólo le pasa la lista real
 * cuando `visible` es true. Un aviso nuevo con la bandeja cerrada ya no hace
 * re-renderizar `TabHeader` — sólo este puente, que no le pega a nada visible.
 */
function NoticeInboxConnected({
  visible, onClose, onOpenNotice, onMarkAll,
}: {
  visible: boolean;
  onClose: () => void;
  onOpenNotice: (item: StoredNotice) => void;
  onMarkAll: () => void;
}) {
  const items = useNoticeInboxStore(s => (visible ? s.items : SIN_ITEMS));
  return (
    <NoticeInboxSheet
      visible={visible}
      items={items}
      onClose={onClose}
      onOpenNotice={onOpenNotice}
      onMarkAll={onMarkAll}
    />
  );
}
