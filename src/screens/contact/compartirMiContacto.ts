import { Share } from 'react-native';
import type { TFunction } from 'i18next';

import { createContactInvite, contactInviteToLink } from '@/src/sync/contactos/contactInvite';
import { ensureIdentity, ensureWrapKeypair, saveContactInvite } from '@/src/store/identityStore';
import type { User } from '@/src/types/models';

/**
 * Arma el link de invitación de contacto recién ACÁ, al tocar "Compartir" —
 * no en el cuerpo del componente (I2, revisión final de T-096 · ADR-015).
 * Calcularlo en render minaba un token nuevo en cada re-render (cualquier
 * cambio de store, cambio de pestaña) y lo persistía en `saveContactInvite`
 * sin que el usuario hubiera compartido nada todavía — invitaciones muertas
 * acumulándose en `K_CONTACT_INVITES` y un riesgo real de que el token
 * mostrado en un render no fuera el mismo que terminaba compartiéndose.
 *
 * `saveContactInvite` (C1, revisión final): sin esto la invitación nunca
 * quedaba en el storage de quien comparte, así que `activeContactInvites`/
 * `processAllContactInvites` no la procesaban nunca del lado de quien
 * comparte — el link de "Compartir" no completaba jamás, aunque alguien lo
 * reclamara. Mismo patrón que `handleShareInvite` en `app/groups/[id].tsx`
 * (`createInvite` + `saveInvite` explícitos en el handler, no dentro de
 * `createInvite`/`createContactInvite`).
 */
export async function compartirMiContacto(currentUser: User | null, t: TFunction) {
  if (!currentUser) return;
  // Sin háptico acá: el `Fab` ya lo dispara al tocarlo.
  const invite = createContactInvite(currentUser.name, ensureIdentity().publicKey, ensureWrapKeypair().publicKey);
  saveContactInvite(invite);
  try {
    await Share.share({
      message: t('contact.share_message', { link: contactInviteToLink(invite) }),
      title: t('contact.share_title'),
    });
  } catch {
    // user cancelled
  }
}
