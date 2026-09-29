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

/** El único ítem que arma `friends.tsx` para la `FlashList` — un bloque completo. */
export type ContactsFlatItem = { kind: 'bloque'; id: 'bloque' };

/**
 * T-154 (rechazo QA): el ítem de FlashList es el BLOQUE completo, no la
 * fila — un `Band` por fila rompía el agrupamiento Aero (`Band` → `Panel`
 * propio por fila en vez de UNA tarjeta para todo el bloque, ver
 * `Band.tsx:83-88`). Con un solo bloque por pantalla, `friends.tsx` lo usa
 * como el único ítem de la `FlashList` — la ganancia de virtualizar acá es
 * de escala futura, no de este dataset.
 */
export function buildContactsFlatItems(contacts: User[]): ContactsFlatItem[] {
  return contacts.length > 0 ? [{ kind: 'bloque', id: 'bloque' }] : [];
}

/**
 * El bloque de filas de contacto — EXACTAMENTE el JSX de `ff2c4eb`: un
 * `Band` compartido envolviendo todos los `ContactRow`. `ContactsCountHeader`
 * y `QrNote` viven fuera de este bloque (`ListHeaderComponent`/
 * `ListFooterComponent` en `friends.tsx`), igual que en `ff2c4eb` estaban
 * en el mismo componente pero antes/después de este `Band`.
 */
export function ContactsBlock({
  contacts, personBalances, conHistorial, aQuienesDebo, onRemove, onSettle,
}: {
  contacts: User[];
  personBalances: PersonBalance[];
  conHistorial: Set<string>;
  aQuienesDebo: Set<string>;
  onRemove: (id: string, name: string) => void;
  onSettle: (id: string) => void;
}) {
  return (
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
            puedeSaldar={aQuienesDebo.has(idCanonico(contact.id))}
            currency={balance?.currency ?? 'ARS'}
            last={i === contacts.length - 1}
            onRemove={onRemove}
            onSettle={onSettle}
          />
        );
      })}
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
