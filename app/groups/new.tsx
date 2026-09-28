import React, { useMemo, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { v4 as uuidv4 } from 'uuid';
import { hapticSelection, hapticSuccess } from '@/src/utils/haptics';

import { DetailHeader } from '@/src/components/CollapsibleHeader';
import { ActionButton } from '@/src/components/ActionButton';
import { ButtonRack } from '@/src/components/ButtonRack';

import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import type { Group } from '@/src/types/models';
import { conAlta, rosterDe } from '@/src/algorithms/roster';
import type { CurrencyCode } from '@/src/constants/currencies';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { announceGroupToContacts } from '@/src/sync/relayEngine';
import { hueForUser } from '@/src/utils/hueForUser';
import { Avatar } from '@/src/components/Avatar';
import { UserAvatar } from '@/src/components/UserAvatar';
import { useTranslation } from 'react-i18next';
import { syncedNow } from '@/src/utils/syncedClock';
import { esYo } from '@/src/store/identityAlias';
import { admiteUnMiembroMas, MAX_MIEMBROS, MAX_TEXTO_CORTO } from '@/src/sync/topes';
import { motivoDeExceso } from '@/src/services/topeDeRegistro';
import { useColors } from '@/src/skins/useSkin';

const PRIMARY_CURRENCIES: CurrencyCode[] = ['ARS', 'USD', 'EUR', 'BRL'];

export default function NewGroupScreen() {
  const { t } = useTranslation();
  const c = useColors();

  const { currentUser } = useAuthStore();
  const { addGroup } = useGroupStore();
  const ensureKey = useGroupKeyStore(st => st.ensureKey);
  const users = useUserStore(s => s.users);

  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('ARS');
  const [selectedIds, setSelectedIds] = useState<string[]>(
    currentUser ? [currentUser.id] : [],
  );

  const contacts = useMemo(
    () => users.filter(u => !u.isDeleted && !esYo(u.id)),
    // `currentUser` no aparece en el cuerpo pero la dependencia es REAL: `esYo`
    // lee la sesión activa, así que cambiar de cuenta tiene que recalcular esto.
    // El linter no puede ver esa dependencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [users, currentUser],
  );

  const hasContact = selectedIds.some(id => !esYo(id));
  const canSave    = name.trim().length > 0 && hasContact;

  function toggleContact(id: string) {
    // T-150 ronda 2/5 (defecto 1, handoff): un grupo nunca puede nacer con más
    // de MAX_MIEMBROS — con ≥100 contactos, crearlo sin este tope daba un
    // grupo de 101 que `excesoDe` excluye de toda publicación en silencio.
    // Mismo aviso que ya usa "agregar miembro" en `[id].tsx`.
    if (!selectedIds.includes(id) && !admiteUnMiembroMas(selectedIds)) {
      Alert.alert(t('group_detail.member_limit_title'), t('group_detail.member_limit_body', { max: MAX_MIEMBROS }));
      return;
    }
    hapticSelection();
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    );
  }

  function handleSave() {
    if (!canSave || !currentUser) return;

    const memberIdsSeleccionados = selectedIds.includes(currentUser.id)
      ? selectedIds
      : [currentUser.id, ...selectedIds];

    const id = uuidv4();
    const ahora = syncedNow();
    // T-182: el roster nace de `conAlta`, uno por seleccionado — nadie escribe
    // `memberIds` a mano; sale derivado de `miembros` (`rosterDe`, abajo).
    const miembrosIniciales = memberIdsSeleccionados.reduce(
      (m, uid) => conAlta({ miembros: m } as Group, uid, ahora).miembros,
      {} as Group['miembros'],
    );
    // `memberIds` se arma en el mismo literal (no en dos pasos): un `as Group`
    // con `memberIds` ausente y `miembros` presente falla el chequeo de tipos
    // ("neither type sufficiently overlaps") porque ya no comparten lo
    // suficiente para que TS confíe en el cast.
    const nuevo: Group = {
      id,
      name:          name.trim(),
      miembros:      miembrosIniciales,
      memberIds:     rosterDe(miembrosIniciales),
      currency,
      createdAt:     Date.now(),
      createdById:   currentUser.id,
      updatedAt:     ahora,
      isDeleted:     false,
    };
    // T-178 (6.4): el mismo predicado que hoy sólo corre al publicar/recibir
    // corre ACÁ antes de escribir — si no, el grupo queda huérfano en este
    // teléfono, sin viajar nunca y sin que nadie se entere.
    const motivo = motivoDeExceso(nuevo);
    if (motivo) {
      Alert.alert(t('sync.record_too_big_title'), t(motivo));
      return;
    }
    hapticSuccess();
    addGroup(nuevo);

    // La clave del grupo y su reparto a los contactos que ya escaneaste. Es lo
    // que hace que el grupo le aparezca al otro sin que tenga que hacer nada.
    ensureKey(id);
    void announceGroupToContacts(id);

    router.back();
  }

  return (
    <SafeAreaView edges={['bottom']} style={[styles.safe, { backgroundColor: c.bg }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

        <DetailHeader
          icon="close"
          title={t('groups.new_title')}
          onBack={() => router.back()}
        />

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Group name */}
          <View style={[styles.inputCard, { backgroundColor: c.surface, borderColor: c.hair }]}>
            <Ionicons name="people-outline" size={18} color={c.textTertiary} />
            <TextInput
              placeholder={t('groups.name_placeholder')}
              placeholderTextColor={c.textTertiary}
              value={name}
              onChangeText={setName}
              maxLength={MAX_TEXTO_CORTO}
              style={[Typography.bodyL, styles.nameInput, { color: c.text }]}
              returnKeyType="done"
              autoFocus
            />
          </View>

          {/* Currency */}
          <Text style={[Typography.label, styles.sectionLabel, { color: c.textTertiary }]}>
            {t('groups.currency_label')}
          </Text>
          <View style={styles.currencyRow}>
            {PRIMARY_CURRENCIES.map(code => (
              <Pressable
                key={code}
                onPress={() => { hapticSelection(); setCurrency(code); }}
                style={[
                  styles.currencyChip,
                  {
                    backgroundColor: currency === code ? c.brand.primary : c.surface,
                    borderColor:     currency === code ? c.brand.primary : c.hair,
                  },
                ]}
              >
                <Text style={[Typography.bodyS, {
                  color:      currency === code ? '#fff' : c.text,
                  fontWeight: '700',
                }]}>
                  {code}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Members */}
          <Text style={[Typography.label, styles.sectionLabel, { color: c.textTertiary }]}>
            {t('groups.participants_label')}
          </Text>

          {/* Yo — siempre fijo */}
          {currentUser && (
            <MemberRow
              id={currentUser.id}
              name={t('groups.you_suffix', { name: currentUser.name })}
              selected
              locked
              onToggle={() => {}}
            />
          )}

          {/* Contactos existentes */}
          {contacts.length === 0 ? (
            <View style={[styles.noContacts, { backgroundColor: c.bgGrouped, borderColor: c.hair }]}>
              <Ionicons name="people-outline" size={24} color={c.textTertiary} />
              <Text style={[Typography.bodyM, { color: c.textTertiary, textAlign: 'center' }]}>
                {t('groups.no_contacts')}
              </Text>
              <Pressable
                onPress={() => router.back()}
                style={[styles.goContactsBtn, { borderColor: c.brand.primary }]}
              >
                <Text style={[Typography.bodyS, { color: c.brand.primary, fontWeight: '700' }]}>
                  {t('groups.go_contacts')}
                </Text>
              </Pressable>
            </View>
          ) : (
            contacts.map(u => (
              <MemberRow
                key={u.id}
                id={u.id}
                name={u.name}
                selected={selectedIds.includes(u.id)}
                locked={false}
                onToggle={() => toggleContact(u.id)}
              />
            ))
          )}

          {/* Hint si no seleccionó nadie */}
          {contacts.length > 0 && !hasContact && (
            <Text style={[Typography.bodyS, styles.hint, { color: c.textTertiary }]}>
              {t('groups.select_hint')}
            </Text>
          )}

          {/* El botón de la app, no un Pressable con estilo propio: es la
              regla del proyecto y lo que hace que «crear» se vea igual en
              todas las pantallas de alta (Nuevo gasto, Registrar pago). */}
          <ButtonRack>
            <ActionButton
              testID="group-new-save"
              label={t('common.create')}
              size="lg"
              full
              disabled={!canSave}
              action={handleSave}
            />
          </ButtonRack>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MemberRow({
  id, name, selected, locked, onToggle,
}: {
  id: string; name: string; selected: boolean; locked: boolean; onToggle: () => void;
}) {
  const c = useColors();

  return (
    <Pressable
      onPress={locked ? undefined : onToggle}
      style={({ pressed }) => [
        styles.memberRow,
        { backgroundColor: c.surface, borderColor: c.hair, opacity: pressed && !locked ? 0.8 : 1 },
      ]}
    >
      <UserAvatar userId={id} name={name} size={38} />
      <Text style={[Typography.bodyM, { flex: 1, color: c.text, fontWeight: '600' }]}>
        {name}
      </Text>
      <View style={[
        styles.check,
        {
          backgroundColor: selected ? c.brand.primary : 'transparent',
          borderColor:     selected ? c.brand.primary : c.border,
          opacity:         locked ? 0.4 : 1,
        },
      ]}>
        {selected && <Ionicons name="checkmark" size={14} color="#fff" />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1 },
  scroll:       { paddingHorizontal: Spacing.screenPad, paddingTop: Spacing[4] },
  sectionLabel: { marginTop: Spacing[5], marginBottom: Spacing[2] },
  inputCard:    {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: Radius.lg, borderWidth: 1,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  nameInput:    { flex: 1, padding: 0, fontWeight: '500' },
  currencyRow:  { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  currencyChip: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: Radius.full, borderWidth: 1 },
  memberRow:    {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 12, borderRadius: Radius.lg, borderWidth: 1,
    marginBottom: 8,
  },
  check:        {
    width: 24, height: 24, borderRadius: 12, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  noContacts:   {
    alignItems: 'center', gap: 10,
    padding: Spacing[5], borderRadius: Radius.lg, borderWidth: 1,
    marginBottom: 8,
  },
  goContactsBtn:{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: Radius.full, borderWidth: 1.5 },
  hint:         { textAlign: 'center', marginTop: 4, marginBottom: 8 },
});
