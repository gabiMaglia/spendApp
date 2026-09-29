import { useTranslation } from 'react-i18next';
import { v4 as uuidv4 } from 'uuid';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';

import { recordGuestAccount, useAuthStore } from '@/src/store/authStore';
import { useEntryGateStore } from '@/src/store/entryGateStore';
import { actualizarMiPerfil } from '@/src/store/miPerfil';
import { adoptarAvatarDelProveedor } from '@/src/services/avatar';
import { codigoDeErrorGoogle } from '@/src/utils/googleSignInError';
import { mergeProviderUser } from '@/src/utils/mergeProviderUser';
import { syncedNow } from '@/src/utils/syncedClock';
import { accountIdFor, ofrecerFusionDeInvitado } from '@/src/screens/auth/cuentaDeLogin';
import { entrarAlDirectorio, type GoogleUser } from '@/src/screens/auth/directorio';

/**
 * Las tres entradas del login: Google, Apple e invitado. T-223: salió de
 * `app/auth/index.tsx` sin cambios de orden — en las tres, `pedirVerificacion`
 * va antes de `setUser` (T-147, filas 9a/9b).
 */
export function useLoginSocial() {
  const { t } = useTranslation();
  const { setUser, getStoredProfile, resolveAccount, confirmAccountLink, keepAccountSeparate } = useAuthStore();
  const deps = { t, resolveAccount, confirmAccountLink, keepAccountSeparate, getStoredProfile };

  /**
   * **T-101-bis: modo invitado.** Entra sin Google ni Apple — un `User` local,
   * sin proveedor real. El sync funciona igual (el buzón acepta clave `anon`,
   * ver `supabase/001_mailbox.sql`); sólo se queda afuera del directorio de
   * claves de ADR-004, que exige un `id_token` real y resuelve, para cualquiera
   * que lo consulte, en el veredicto `sin_directorio` — el único que
   * `authorHealth.ts` nunca usa para rechazar un sobre.
   *
   * Se anota como pendiente de fusión (`recordGuestAccount`): si esta persona
   * entra después con una cuenta real, se le ofrece sumar estos datos.
   */
  function entrarComoInvitado() {
    const id = uuidv4();
    recordGuestAccount(id);
    // T-147 (fila 9a, decisión del PO 2026-09-27): pide la verificación
    // bloqueante ANTES de `setUser` — `AuthGuard` la lee en el mismo tick en
    // que `currentUser` deja de ser `null`, así que nunca hay un instante en
    // el que pudiera mandar directo a tabs sin haber pedido nada.
    useEntryGateStore.getState().pedirVerificacion();
    setUser({
      id,
      name:         t('auth.guest_name'),
      email:        '',
      authProvider: 'guest',
      createdAt:    syncedNow(),
      updatedAt:    syncedNow(),
      isDeleted:    false,
    });
  }

  async function handleGoogleLogin() {
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      // La forma del retorno varía por versión; contemplamos {data:{user}} y {user}.
      const response = (await GoogleSignin.signIn()) as unknown as {
        data?: { user?: GoogleUser; idToken?: string | null };
        user?: GoogleUser;
        idToken?: string | null;
      };
      const u = response?.data?.user ?? response?.user;
      if (!u) return; // cancelado

      // Mismo mail ⇒ misma cuenta, entre con Google o con Apple.
      accountIdFor(deps, u.id, u.email, (accountId) => {
        ofrecerFusionDeInvitado(t, accountId, u.email);
        // T-147 (fila 9b): igual que en `entrarComoInvitado`, antes de `setUser`.
        useEntryGateStore.getState().pedirVerificacion();
        setUser(mergeProviderUser(getStoredProfile(accountId), {
          id:           accountId,
          authProvider: 'google',
          name:         u.name ?? u.givenName,
          email:        u.email,
          avatarUrl:    u.photo,
          // T-188a: este login es LA MISMA PERSONA (idEstable), aunque el
          // perfil guardado esté anonimizado por un borrado anterior — pisa
          // el «Cuenta borrada».
          deletedAt:    undefined,
        }));

        // La foto de Google se adopta como bytes propios UNA vez. A partir de
        // acá deja de depender de su CDN: no caduca, se dibuja sin internet y
        // nadie afuera se entera de quién la mira. Va sin await: si falla o
        // tarda, se entra igual y quedan las iniciales.
        void adoptarAvatarDelProveedor(u.photo ?? undefined).then(foto => {
          if (!foto) return;
          const yo = useAuthStore.getState().currentUser;
          if (!yo || yo.id !== accountId || yo.avatar) return; // ya eligió una: no se pisa
          // Por `actualizarMiPerfil` y no `setUser` suelto: la foto tiene que
          // llegar TAMBIÉN a userStore (que es lo que arma el delta de sync) y
          // anunciarse a los contactos. Con `setUser` solo, la foto de Google
          // la veía únicamente su dueño y nadie más, para siempre.
          actualizarMiPerfil({ avatar: foto });
        });

        // Directorio de claves (ADR-004): se aprovecha el MISMO id_token del
        // login, así que no hay una segunda pantalla para el usuario. Va sin
        // await y sin bloquear: si falla, la app entra igual.
        void entrarAlDirectorio('google', response?.data?.idToken ?? response?.idToken, u.id);
      });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === statusCodes.SIGN_IN_CANCELLED || code === statusCodes.IN_PROGRESS) return;
      // T-138: el código real va en el aviso — sin él no hay forma de saber
      // si falta un SHA-1 (DEVELOPER_ERROR), si es la red o Play Services.
      alert(t('auth.error_google_code', { code: codigoDeErrorGoogle(e) }));
    }
  }

  async function handleAppleLogin() {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      // Apple manda fullName y email SOLO en el primer login de cada Apple ID;
      // después llegan null. Por eso NO se arma el User acá: mergeProviderUser
      // combina lo que llegue con el perfil ya persistido (que sobrevive al
      // signOut) y deja ganar al dato local. Ver src/utils/mergeProviderUser.ts.
      const name = [
        credential.fullName?.givenName,
        credential.fullName?.familyName,
      ].filter(Boolean).join(' ');

      accountIdFor(deps, credential.user, credential.email, (accountId) => {
        ofrecerFusionDeInvitado(t, accountId, credential.email ?? name);
        // T-147 (fila 9b): igual que en `entrarComoInvitado`, antes de `setUser`.
        useEntryGateStore.getState().pedirVerificacion();
        setUser(mergeProviderUser(getStoredProfile(accountId), {
          id:           accountId,
          authProvider: 'apple',
          name,
          email:        credential.email,
          // T-188a: ídem Google — este login es la misma persona.
          deletedAt:    undefined,
        }));

        void entrarAlDirectorio('apple', credential.identityToken, credential.user);
      });
    } catch (e: any) {
      if (e.code !== 'ERR_REQUEST_CANCELED') {
        alert(t('auth.error_apple'));
      }
    }
  }

  return { entrarComoInvitado, handleGoogleLogin, handleAppleLogin };
}
