import React from 'react';
import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useHeaderColapsable } from '@/src/hooks/useHeaderColapsable';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { formatMoney } from '@/src/constants/currencies';
import { useAuthStore } from '@/src/store/authStore';
import { Fab, FabRow } from '@/src/components/Fab';
import { SplitStat } from '@/src/components/Band';
import { TabHeader } from '@/src/components/TabHeader';
import { useHeaderPadding, useLimiteContenido } from '@/src/components/CollapsibleHeader';

import { useFriendsBalances } from '@/src/screens/friends/hooks/useFriendsBalances';
import { useFriendsContacts } from '@/src/screens/friends/hooks/useFriendsContacts';
import { useAddContactSheet } from '@/src/screens/friends/hooks/useAddContactSheet';
import { ContactsList } from '@/src/screens/friends/components/ContactsList';
import { AddContactSheet } from '@/src/screens/friends/components/AddContactSheet';
import { useColors } from '@/src/skins/useSkin';

export default function FriendsScreen() {
  const { t } = useTranslation();
  // 0 (PO 2026-09-22): sin gap entre el header y el bloque "te deben/debés".
  const headerPad = useHeaderPadding(0);
  const limiteContenido = useLimiteContenido();
  const c = useColors();
  const { currentUser } = useAuthStore();

  const { scrollHandler, progress, contenidoMinimo, alMedirScroll } = useHeaderColapsable();

  const {
    cur, personBalances, owedToYou, youOwe, owedToYouPending, youOwePending,
  } = useFriendsBalances(currentUser?.id ?? '');
  const { contacts, conHistorial, blocked, handleRemove, handleSettle, handleToggleBlock } = useFriendsContacts();
  const addSheet = useAddContactSheet();
  const pendingCalculando = t('fx.calculating');

  // Sin 'bottom': la tab bar ya reserva el inset del sistema (_layout.tsx); contarlo acá dejaba una franja muerta entre el contenido y la barra.
  return (
    <SafeAreaView edges={[]} style={[styles.safe, { backgroundColor: c.bg }]}>
      <Animated.ScrollView
        style={limiteContenido}
        onLayout={alMedirScroll}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={scrollHandler}
        contentContainerStyle={[{ paddingTop: headerPad, paddingBottom: 150, flexGrow: 1 }, contenidoMinimo]}
      >
        {(owedToYou > 0 || youOwe > 0) && (
          <SplitStat
            noTop
            items={[
              {
                label: t('friends.owed_to_you'), value: formatMoney(owedToYou, cur), color: c.semantic.positive,
                id: 'friends.owedToYou', minor: owedToYou, code: cur,
                pending: owedToYouPending, pendingLabel: pendingCalculando,
              },
              {
                label: t('friends.you_owe'), value: formatMoney(youOwe, cur), color: c.textSecondary,
                id: 'friends.youOwe', minor: youOwe, code: cur,
                pending: youOwePending, pendingLabel: pendingCalculando,
              },
            ]}
          />
        )}

        <ContactsList
          contacts={contacts}
          personBalances={personBalances}
          conHistorial={conHistorial}
          blocked={blocked}
          onRemove={handleRemove}
          onSettle={handleSettle}
          onToggleBlock={handleToggleBlock}
        />
      </Animated.ScrollView>

      <TabHeader title={t('friends.title')} progress={progress} />

      <FabRow>
        <Fab
          onPress={() => router.push('/contact/add' as any)}
          icon="qr-code-outline"
          label={t('friends.add_by_qr')}
          backgroundColor={c.brand.primary}
        />
      </FabRow>

      <AddContactSheet
        visible={addSheet.visible}
        onClose={addSheet.close}
        name={addSheet.name}
        onChangeName={addSheet.setName}
        inputRef={addSheet.inputRef}
        onConfirm={addSheet.confirm}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
});
