import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Band } from '@/src/components/Band';
import { EmptyState } from '@/src/components/EmptyState';
import { idCanonico } from '@/src/store/identityAlias';
import type { User } from '@/src/types/models';
import type { PersonBalance } from '@/src/store/selectors';
import { ContactsCountHeader } from './ContactsCountHeader';
import { ContactRow } from './ContactRow';

/** Estado vacío, o la lista de contactos con su saldo — encabezado con mármol incluido. */
export function ContactsList({
  contacts, personBalances, conHistorial, onRemove, onSettle,
}: {
  contacts: User[];
  personBalances: PersonBalance[];
  conHistorial: Set<string>;
  onRemove: (id: string, name: string) => void;
  onSettle: (id: string, amount: number, currency: string) => void;
}) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  if (contacts.length === 0) {
    return (
      <EmptyState
        iconName="people-outline"
        title={t('friends.empty_title')}
        body={t('friends.empty_body')}
      />
    );
  }

  return (
    <>
      <ContactsCountHeader count={contacts.length} />
      <Band noTop>
        {contacts.map((contact, i) => {
          const balance = personBalances.find(b => b.userId === contact.id);
          return (
            <ContactRow
              key={contact.id}
              userId={contact.id}
              name={contact.name}
              amount={balance?.amount}
              conHistorial={conHistorial.has(idCanonico(contact.id))}
              currency={balance?.currency ?? 'ARS'}
              last={i === contacts.length - 1}
              onRemove={onRemove}
              onSettle={onSettle}
            />
          );
        })}
      </Band>
      <Text style={[Typography.caption, styles.footnote, { color: c.textTertiary }]}>
        {t('friends.qr_note')}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  footnote: { paddingHorizontal: Spacing.screenPad, paddingTop: 14, lineHeight: 17 },
});
