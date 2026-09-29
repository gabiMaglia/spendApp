import { Alert } from 'react-native';
import type { TFunction } from 'i18next';

import { clearGuestAccount, pendingGuestAccountId, useAuthStore } from '@/src/store/authStore';
import { mergeAccounts } from '@/src/store/accountLink';
import { probarOtroProveedor } from '@/src/screens/auth/directorio';

type Auth = ReturnType<typeof useAuthStore.getState>;

/** Lo que la resolución de cuenta usa de la pantalla (T-223: antes era cierre). */
export type DepsDeCuenta = {
  t: TFunction;
  resolveAccount: Auth['resolveAccount'];
  confirmAccountLink: Auth['confirmAccountLink'];
  keepAccountSeparate: Auth['keepAccountSeparate'];
  getStoredProfile: Auth['getStoredProfile'];
};

// Resuelve a qué cuenta entra este login. Si el proveedor no mandó email
// (Apple sólo lo manda la 1ª vez) y ya hay otras cuentas en el device, no se
// adivina: se le pregunta al usuario (decisión del PO). Devuelve el id de
// cuenta, o null si el usuario todavía tiene que decidir.
export function accountIdFor(
  deps: DepsDeCuenta,
  providerId: string,
  email: string | null | undefined,
  onResolved: (accountId: string) => void,
) {
  const { t, resolveAccount, confirmAccountLink, keepAccountSeparate, getStoredProfile } = deps;
  const r = resolveAccount(providerId, email);

  if (r.kind !== 'confirm') { onResolved(r.accountId); return; }

  const candidate = r.candidates[0];

  /**
   * Fusionar exige probar el proveedor de la cuenta destino (T-042). Si no
   * está probado, se le ofrece al usuario entrar con esa cuenta ahora.
   *
   * **Si no se puede probar, NO se registra «mantenerlas separadas».** Esa
   * decisión es permanente —apunta el proveedor a su propia cuenta y el
   * próximo login ya no pregunta— así que usarla como caída dejaría la fusión
   * legítima imposible para siempre. Se entra sin unir y se vuelve a
   * preguntar la próxima vez.
   */
  async function unir(): Promise<void> {
    let r2 = confirmAccountLink(providerId, candidate.accountId);

    if (!r2.ok) {
      const proveedorDestino = getStoredProfile(candidate.accountId)?.authProvider;
      // Un invitado (T-101-bis) nunca entra a este índice de candidatos
      // (`setUser` no lo registra), así que esto es sólo para que el tipo
      // cierre: `probarOtroProveedor` solo sabe entrar con Google o Apple.
      const probado = (proveedorDestino === 'google' || proveedorDestino === 'apple')
        ? await probarOtroProveedor(proveedorDestino)
        : false;
      r2 = probado
        ? confirmAccountLink(providerId, candidate.accountId)
        : { ok: false, reason: 'sin_prueba' };
    }

    if (!r2.ok) {
      Alert.alert(t('auth.link_need_proof_title'), t('auth.link_need_proof_body'));
      onResolved(providerId);   // entra sin unir; la próxima vez se vuelve a preguntar
      return;
    }
    onResolved(candidate.accountId);
  }

  Alert.alert(
    t('auth.link_title'),
    `${t('auth.link_body', { account: candidate.label })}\n\n${t('auth.link_irreversible')}`,
    [
      {
        text: t('auth.link_separate'),
        style: 'cancel',
        onPress: () => {
          // Registrar la decisión, no sólo actuarla: sin esto el próximo
          // login no encuentra el proveedor en el índice y, si el email
          // coincide con otra cuenta, la absorbe sin preguntar. El usuario
          // dijo «separadas» y la app las junta igual, un login después.
          keepAccountSeparate(providerId, email);
          onResolved(providerId);
        },
      },
      {
        text: t('auth.link_confirm'),
        onPress: () => { void unir(); },
      },
    ],
  );
}

/**
 * Si este dispositivo tiene una cuenta invitada pendiente (T-101-bis), ofrece
 * fusionarla con la cuenta real recién resuelta — mismo mecanismo que T-042
 * (`mergeAccounts`), pero sin necesitar "probar" nada: pasar de invitado a una
 * cuenta real en el mismo aparato ya es la prueba.
 */
export function ofrecerFusionDeInvitado(t: TFunction, accountId: string, label: string) {
  const guestId = pendingGuestAccountId();
  if (!guestId || guestId === accountId) return;

  Alert.alert(
    t('auth.guest_merge_title'),
    t('auth.guest_merge_body', { account: label }),
    [
      { text: t('auth.guest_merge_no'), style: 'cancel', onPress: clearGuestAccount },
      {
        text: t('auth.guest_merge_yes'),
        onPress: () => { mergeAccounts(guestId, accountId); clearGuestAccount(); },
      },
    ],
  );
}
