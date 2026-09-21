import React, { useState } from 'react';
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SharedValue } from 'react-native-reanimated';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { CollapsibleHeader, HeaderCurrency } from './CollapsibleHeader';
import { Colors } from '@/src/constants/colors';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { NoticeBell } from './NoticeBell';
import { NoticeInboxSheet } from './NoticeInboxSheet';
import { GroupKeyConflictCard } from './GroupKeyConflictCard';
import { BottomSheet } from './Sheet';
import { CurrencySheet } from './CurrencyPicker';
import { UserAvatar } from './UserAvatar';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useSettingsStore } from '@/src/store/settingsStore';
import {
  useNoticeInboxStore, useUnreadNoticeCount, type StoredNotice,
} from '@/src/store/noticeInboxStore';
import { esAccionable, type KeyConflictNotice } from '@/src/services/syncNotices';
import { ofertasDe } from '@/src/sync/groupKeyOffers';
import { hapticLight } from '@/src/utils/haptics';
import { syncedNow } from '@/src/utils/syncedClock';

/**
 * **El header de las seis tabs. Uno solo, con lo mismo en todas.**
 *
 * Antes cada tab lo armaba a mano y ninguna coincidía: el dashboard tenía la
 * campana y el selector de moneda, Actividad no tenía ninguno de los dos,
 * Perfil no tenía ni avatar, y las tres restantes tenían moneda pero no
 * campana. La bandeja de avisos existía en UNA pantalla — o sea que enterarse
 * de algo dependía de en qué tab estabas parado.
 *
 * Los tres elementos y su orden son decisión del PO (2026-09-02): **avatar con
 * la foto de perfil, campana de notificaciones y selector de moneda maestra.**
 *
 * El avatar es `UserAvatar` y no `HeaderAvatar`: aquél resuelve la FOTO y cae a
 * las iniciales solo si no hay. `HeaderAvatar` dibujaba iniciales siempre, que
 * es lo que el PO vino a corregir.
 *
 * Las dos hojas —bandeja y monedas— viven acá adentro. Es lo que hace que esto
 * sea un componente y no un objeto de props: si cada tab tuviera que montarlas,
 * la próxima tab nueva se olvidaría de una y nadie lo notaría hasta que a
 * alguien no le llegue un aviso.
 */
export function TabHeader({
  title, subtitle, progress, settingsAction,
}: {
  title: string;
  /** Sólo Inicio lo pasa hoy: "Hola, {nombre}" arriba del título (T-114). */
  subtitle?: string;
  /** Progreso de colapso en [0,1] — de `useHeaderColapsable` (T-128). */
  progress: SharedValue<number>;
  /** Engranaje de ajustes junto a la campana — sólo Personal lo pasa hoy (PO 2026-09-20). */
  settingsAction?: () => void;
}) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const currentUser = useAuthStore(s => s.currentUser);
  const cur         = useSettingsStore(s => s.displayCurrency);
  const setCurrency = useSettingsStore(s => s.setDisplayCurrency);
  const groups      = useGroupStore(s => s.groups);
  const expenses    = useExpenseStore(s => s.expenses);

  const inboxItems  = useNoticeInboxStore(s => s.items);
  const sinLeer     = useUnreadNoticeCount();
  const markRead      = useNoticeInboxStore(s => s.markRead);
  const markAllRead   = useNoticeInboxStore(s => s.markAllRead);
  const markReadWhere = useNoticeInboxStore(s => s.markReadWhere);

  const [bandeja, setBandeja] = useState(false);
  const [monedas, setMonedas] = useState(false);
  /** Aviso de claves en disputa abierto (T-136): el id para marcarlo leído al resolver. */
  const [conflicto, setConflicto] = useState<{ id: string; notice: KeyConflictNotice } | null>(null);

  /**
   * **Abrir la campana marca leídas las que NO piden acción** (PO 2026-09-13,
   * T-119). Las accionables (`esAccionable`: `deletion`, `settlement_pending`,
   * `sync_down`) siguen pendientes — abrirlas no las resuelve, hace falta
   * actuar (objetar/acusar recibo/reintentar). El botón "Marcar todo" de la
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
      const grupoNuevo = groups.find(g => g.id === aviso.newGroupId && !g.isDeleted);
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

    const grupo = groups.find(g => g.id === aviso.groupId && !g.isDeleted);
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
          <Pressable
            testID="header-profile"
            onPress={() => { hapticLight(); router.push('/(tabs)/user' as never); }}
            accessibilityRole="button"
            accessibilityLabel={t('dashboard.go_to_profile')}
            hitSlop={8}
          >
            {/* T-115: anillo de marca — sugiere que la foto es un botón (a "Yo"
                se llega tocándola, ya no hay pestaña propia). */}
            <UserAvatar
              userId={currentUser?.id ?? ''}
              name={currentUser?.name}
              size={32}
              ring={c.brand.primary}
            />
          </Pressable>
        }
        right={
          <>
            <NoticeBell unread={sinLeer} onPress={abrirCampana} />
            {settingsAction && (
              <Pressable
                testID="header-settings-btn"
                onPress={() => { hapticLight(); settingsAction(); }}
                accessibilityRole="button"
                hitSlop={8}
              >
                <Ionicons name="settings-outline" size={20} color={c.textSecondary} />
              </Pressable>
            )}
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
      <NoticeInboxSheet
        visible={bandeja}
        items={inboxItems}
        expenses={expenses}
        now={syncedNow()}
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
