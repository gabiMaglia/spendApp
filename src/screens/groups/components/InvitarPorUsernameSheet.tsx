import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { BottomSheet, SheetOptionAvatar } from '@/src/components/Sheet';
import { useUserStore } from '@/src/store/userStore';
import { esYo } from '@/src/store/identityAlias';
import { MAX_TEXTO_CORTO } from '@/src/sync/nucleo/topes';
import { useColors } from '@/src/skins/useSkin';
import type { Group, User } from '@/src/types/models';

// Referencia estable: con el modal cerrado el selector de abajo siempre
// devuelve ESTA MISMA instancia, así que Zustand no dispara un re-render
// aunque `users` cambie en cualquier otra parte de la app.
const SIN_USUARIOS: User[] = [];

/**
 * T-209 — el modal "invitar por username" vive siempre montado (mismo lugar
 * que antes en `app/groups/[id].tsx`, para no perder la animación de
 * apertura/cierre del `BottomSheet` compartido), pero la suscripción a
 * `useUserStore(s => s.users)` queda CONDICIONADA a `visible`: cerrado, el
 * selector devuelve `SIN_USUARIOS` (misma referencia siempre) y Zustand no
 * vuelve a renderizar este componente — ni, por lo tanto, la pantalla que lo
 * contiene. Antes esa suscripción vivía sin condición en la pantalla: un
 * alta/edición de contacto en CUALQUIER PARTE de la app re-renderizaba el
 * detalle de grupo entero (balances, timeline, todo).
 *
 * El resto de la lógica (tope de miembros, `ensureKey`, anuncio por relay)
 * sigue en la pantalla — sólo se movió lo que necesitaba `allUsers`.
 */
export function InvitarPorUsernameSheet({
  visible, onClose, title, group, currentUser, onAddContact, onAddWithoutApp,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  group: Group;
  currentUser: User | null | undefined;
  onAddContact: (userId: string) => void;
  onAddWithoutApp: (name: string) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const allUsers = useUserStore(s => (visible ? s.users : SIN_USUARIOS));

  const [inviteName, setInviteName] = useState('');
  const [sinApp, setSinApp] = useState(false);

  const contactosDisponibles = useMemo(
    () => allUsers.filter(u =>
      !u.isDeleted && !esYo(u.id) && !group.memberIds.includes(u.id),
    ),
    // `currentUser` no aparece en el cuerpo pero la dependencia es REAL: `esYo`
    // lee la sesión activa, así que cambiar de cuenta tiene que recalcular esto.
    // El linter no puede ver esa dependencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allUsers, group, currentUser],
  );

  function confirmarSinApp() {
    onAddWithoutApp(inviteName);
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      {contactosDisponibles.length > 0 && (
        <>
          <Text style={[Typography.bodyS, { color: c.textSecondary, marginBottom: 12 }]}>
            {t('group_detail.add_from_contacts')}
          </Text>
          {contactosDisponibles.map(u => (
            <SheetOptionAvatar
              key={u.id}
              userId={u.id}
              name={u.name}
              selected={false}
              onPress={() => onAddContact(u.id)}
            />
          ))}
        </>
      )}

      <Pressable
        accessibilityRole="button"
        onPress={() => setSinApp(v => !v)}
        style={{ marginTop: contactosDisponibles.length > 0 ? Spacing[5] : 0, marginBottom: Spacing[2] }}
      >
        <Text style={{ fontSize: 12.5, fontWeight: '700', color: c.brand.primary }}>
          {t('group_detail.add_without_app')}
        </Text>
      </Pressable>

      {sinApp && (
        <>
          <Text style={[Typography.caption, { color: c.textSecondary, marginBottom: 12 }]}>
            {t('group_detail.without_app_warning')}
          </Text>
          <TextInput
            value={inviteName}
            onChangeText={setInviteName}
            placeholder={t('group_detail.name_placeholder')}
            placeholderTextColor={c.textTertiary}
            style={[styles.input, { backgroundColor: c.bgGrouped, color: c.text, borderColor: c.hair }]}
            returnKeyType="done"
            onSubmitEditing={confirmarSinApp}
            maxLength={MAX_TEXTO_CORTO}
          />
          <Pressable
            accessibilityRole="button"
            onPress={confirmarSinApp}
            style={[styles.confirmBtn, {
              backgroundColor: inviteName.trim() ? c.brand.primary : c.bgGrouped,
            }]}
          >
            <Text style={{
              fontSize: 15, fontWeight: '700',
              color: inviteName.trim() ? '#fff' : c.textTertiary,
            }}>
              {t('group_detail.add_to_group')}
            </Text>
          </Pressable>
        </>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  input:      {
    height: 50, borderRadius: Radius.md, borderWidth: 1,
    paddingHorizontal: 14, fontSize: 16, marginBottom: 14,
  },
  confirmBtn: { height: 50, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
});
