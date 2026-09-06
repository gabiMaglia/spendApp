import React, { useState } from 'react';
import { Animated, Pressable } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { CollapsibleHeader, HeaderCurrency } from './CollapsibleHeader';
import { NoticeBell } from './NoticeBell';
import { NoticeInboxSheet } from './NoticeInboxSheet';
import { CurrencySheet } from './CurrencyPicker';
import { UserAvatar } from './UserAvatar';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useSettingsStore } from '@/src/store/settingsStore';
import {
  useNoticeInboxStore, useUnreadNoticeCount, type StoredNotice,
} from '@/src/store/noticeInboxStore';
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
export function TabHeader({ title, scrollY }: { title: string; scrollY: Animated.Value }) {
  const { t } = useTranslation();
  const currentUser = useAuthStore(s => s.currentUser);
  const cur         = useSettingsStore(s => s.displayCurrency);
  const setCurrency = useSettingsStore(s => s.setDisplayCurrency);
  const groups      = useGroupStore(s => s.groups);
  const expenses    = useExpenseStore(s => s.expenses);

  const inboxItems  = useNoticeInboxStore(s => s.items);
  const sinLeer     = useUnreadNoticeCount();
  const markRead    = useNoticeInboxStore(s => s.markRead);
  const markAllRead = useNoticeInboxStore(s => s.markAllRead);

  const [bandeja, setBandeja] = useState(false);
  const [monedas, setMonedas] = useState(false);

  function abrirAviso(item: StoredNotice) {
    markRead(item.id);
    setBandeja(false);

    // No todo aviso es de un grupo: el del reloj (T-038) es del aparato. Se
    // marca leído y no se navega a ningún lado, que es lo correcto — no hay
    // pantalla adentro de la app donde arreglar la hora del teléfono.
    // La constante es necesaria para que TypeScript estreche el union: sobre
    // `item.notice` el `in` no acota nada.
    const aviso = item.notice;
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
        scrollY={scrollY}
        left={
          <Pressable
            testID="header-profile"
            onPress={() => { hapticLight(); router.push('/(tabs)/user' as never); }}
            accessibilityRole="button"
            accessibilityLabel={t('dashboard.go_to_profile')}
            hitSlop={8}
          >
            <UserAvatar userId={currentUser?.id ?? ''} name={currentUser?.name} size={32} />
          </Pressable>
        }
        right={
          <>
            <NoticeBell unread={sinLeer} onPress={() => setBandeja(true)} />
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
    </>
  );
}
