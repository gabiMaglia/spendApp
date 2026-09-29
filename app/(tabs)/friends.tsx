import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { FlashList } from '@shopify/flash-list';
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
import {
  buildContactsFlatItems, ContactsBlock, ContactsEmptyState, QrNote, type ContactsFlatItem,
} from '@/src/screens/friends/components/ContactsList';
import { ContactsCountHeader } from '@/src/screens/friends/components/ContactsCountHeader';
import { AddContactSheet } from '@/src/screens/friends/components/AddContactSheet';
import { useColors } from '@/src/skins/useSkin';
import { useContadorDeRenders } from '@/src/hooks/useContadorDeRenders';

// Mismo patrón que Actividad/Grupos (T-154): FlashList no es Animated por sí
// sola, se envuelve para seguir enganchada a `useHeaderColapsable` (Reanimated).
const AnimatedFlashList = Animated.createAnimatedComponent(FlashList<ContactsFlatItem>);

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
  const { contacts, conHistorial, handleRemove, handleSettle } = useFriendsContacts();
  const addSheet = useAddContactSheet();
  const pendingCalculando = t('fx.calculating');

  useContadorDeRenders('Amigos', { contactsCount: contacts.length, owedToYou, youOwe });

  const items = buildContactsFlatItems(contacts);

  // Sin 'bottom': la tab bar ya reserva el inset del sistema (_layout.tsx); contarlo acá dejaba una franja muerta entre el contenido y la barra.
  return (
    <SafeAreaView edges={[]} style={[styles.safe, { backgroundColor: c.bg }]}>
      {/* T-219b: el margen bajo la barra (`useLimiteContenido`) va en ESTE View,
          nunca en el `style` del AnimatedFlashList — Reanimated le pasa `style`
          como array y FlashList v2 lo mezcla con spread de objeto: el margen se pierde. */}
      <View style={[styles.lista, limiteContenido]}>
        <AnimatedFlashList
          onLayout={alMedirScroll}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={scrollHandler}
          contentContainerStyle={[{ paddingBottom: 150, flexGrow: 1 }, contenidoMinimo]}
          data={items}
          keyExtractor={(it) => it.id}
          getItemType={(it) => it.kind}
          renderItem={() => (
            <ContactsBlock
              contacts={contacts}
              personBalances={personBalances}
              conHistorial={conHistorial}
              onRemove={handleRemove}
              onSettle={handleSettle}
            />
          )}
          // T-219: el offset del header vive acá, no en contentContainerStyle —
          // mismo motivo que Actividad/Grupos (FlashList v2 mide dónde termina
          // el ListHeaderComponent, no lee el padding de la lista).
          ListHeaderComponentStyle={{ paddingTop: headerPad }}
          ListHeaderComponent={
            <>
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
              {contacts.length > 0 && <ContactsCountHeader count={contacts.length} />}
            </>
          }
          ListEmptyComponent={<ContactsEmptyState />}
          ListFooterComponent={contacts.length > 0 ? <QrNote /> : undefined}
        />
      </View>

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
  lista: { flex: 1 },
});
