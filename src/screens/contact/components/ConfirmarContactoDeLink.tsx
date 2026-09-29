import React from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmSheet } from '@/src/components/Sheet';
import { shortFingerprint } from '@/src/utils/keyFingerprint';
import type { ContactPayload } from '@/src/utils/contactLink';

type Props = {
  contacto: ContactPayload | null;
  onClose: () => void;
  onConfirm: () => void;
};

/**
 * Confirmación de contacto por link (T-093 / SEC H-1): nadie estuvo delante, así
 * que antes de agregar/pinnear/anunciar se muestra nombre + huella de su clave.
 */
export function ConfirmarContactoDeLink({ contacto, onClose, onConfirm }: Props) {
  const { t } = useTranslation();
  return (
    <ConfirmSheet
      visible={!!contacto}
      onClose={onClose}
      onConfirm={onConfirm}
      danger={false}
      title={t('contact.confirm_title', { name: contacto?.name ?? '' })}
      body={
        contacto?.identityPublicKey
          ? t('contact.confirm_body', { fingerprint: shortFingerprint(contacto.identityPublicKey) })
          : t('contact.confirm_no_key')
      }
      confirmLabel={t('contact.confirm_add')}
      cancelLabel={t('common.cancel')}
      confirmTestID="contact-confirm-add"
      cancelTestID="contact-confirm-cancel"
    />
  );
}
