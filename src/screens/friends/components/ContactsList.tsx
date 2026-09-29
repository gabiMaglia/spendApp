import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { Band } from '@/src/components/Band';
import { EmptyState } from '@/src/components/EmptyState';
import { idCanonico } from '@/src/store/identityAlias';
import type { User } from '@/src/types/models';
import type { PersonBalance } from '@/src/store/selectors';
import { ContactRow } from './ContactRow';
import { useColors } from '@/src/skins/useSkin';

export type ContactsFlatItem = {
  kind: 'contact'; id: string; contact: User; amount?: number; currency: string;
  conHistorial: boolean; isLast: boolean;
};

/** Aplana los contactos en ítems planos (T-154, FlashList). Resuelve el saldo por
 * contacto acá mismo — antes lo hacía el `.map()` de `ContactsList`. */
export function buildContactsFlatItems(
  contacts: User[], personBalances: PersonBalance[], conHistorial: Set<string>,
): ContactsFlatItem[] {
  return contacts.map((contact, i) => {
    const balance = personBalances.find(b => b.userId === contact.id);
    return {
      kind: 'contact', id: contact.id, contact,
      amount: balance?.amount, currency: balance?.currency ?? 'ARS',
      conHistorial: conHistorial.has(idCanonico(contact.id)),
      isLast: i === contacts.length - 1,
    };
  });
}

/** Fila de contacto, con su propio `Band` (mismo criterio que Grupos/Actividad:
 * antes era un `Band` compartido envolviendo todas las filas). */
export function ContactsListItem({
  item, onRemove, onSettle,
}: {
  item: ContactsFlatItem;
  onRemove: (id: string, name: string) => void;
  onSettle: (id: string, amount: number, currency: string) => void;
}) {
  return (
    <Band noTop noBottom={!item.isLast}>
      <ContactRow
        userId={item.contact.id}
        name={item.contact.name}
        amount={item.amount}
        conHistorial={item.conHistorial}
        currency={item.currency}
        last={item.isLast}
        onRemove={onRemove}
        onSettle={onSettle}
      />
    </Band>
  );
}

/** Estado vacío — sin contactos todavía. */
export function ContactsEmptyState() {
  const { t } = useTranslation();
  return (
    <EmptyState
      iconName="people-outline"
      title={t('friends.empty_title')}
      body={t('friends.empty_body')}
    />
  );
}

/** Leyenda del pie — sólo tiene sentido con contactos en la lista. */
export function QrNote() {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <Text style={[Typography.caption, styles.footnote, { color: c.textTertiary }]}>
      {t('friends.qr_note')}
    </Text>
  );
}

const styles = StyleSheet.create({
  footnote: { paddingHorizontal: Spacing.screenPad, paddingTop: 14, lineHeight: 17 },
});
