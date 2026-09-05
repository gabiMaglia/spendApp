import React, { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { DetailHeader } from '@/src/components/CollapsibleHeader';
import { deleteAccount } from '@/src/services/deleteAccount';
import { LEGAL_DISPONIBLE, urlDeBorrado } from '@/src/constants/legal';
import { hapticWarning } from '@/src/utils/haptics';

/**
 * Borrar la cuenta (T-074). **Requisito duro de las dos tiendas**, y con dos
 * límites que no son negociables:
 *
 * - no se puede ofrecer «desactivar» o «pausar» en vez de borrar;
 * - no se puede mandar al usuario a escribir un mail para completarlo.
 *
 * Por eso esta pantalla no tiene salida lateral: explica qué se borra, qué no
 * se puede borrar, y borra. Lo que NO se puede borrar se dice **antes** de que
 * el usuario toque el botón, no después.
 */
export default function BorrarCuentaScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { t } = useTranslation();
  const [borrando, setBorrando] = useState(false);

  async function borrar() {
    setBorrando(true);
    const r = await deleteAccount({ nombreAnonimo: t('account_delete.anon_name') });
    setBorrando(false);

    // Quedó buzón sin purgar: se dice, no se disimula. Se reintenta al abrir.
    if (r.topicsPendientes > 0) {
      Alert.alert(t('account_delete.title'), t('account_delete.partial'));
    }
    router.replace('/auth');
  }

  function confirmar() {
    void hapticWarning();
    Alert.alert(
      t('account_delete.confirm_title'),
      t('account_delete.confirm_body'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('account_delete.confirm'), style: 'destructive', onPress: () => void borrar() },
      ],
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <DetailHeader title={t('account_delete.title')} onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.scroll}>
        <Bloque titulo={t('account_delete.what_title')} color={c.text}>
          <Linea texto={t('account_delete.what_1')} color={c.textSecondary} />
          <Linea texto={t('account_delete.what_2')} color={c.textSecondary} />
          <Linea texto={t('account_delete.what_3')} color={c.textSecondary} />
        </Bloque>

        <Bloque titulo={t('account_delete.kept_title')} color={c.text}>
          <Linea texto={t('account_delete.kept_1')} color={c.textSecondary} />
          <Linea texto={t('account_delete.kept_2')} color={c.textSecondary} />
        </Bloque>

        <View style={[styles.nota, { borderColor: c.hair, backgroundColor: c.surface }]}>
          <Text style={[Typography.bodyS, { color: c.textSecondary }]}>
            {t('account_delete.no_server')}
          </Text>
          <Text style={[Typography.bodyS, { color: c.textSecondary }]}>
            {t('account_delete.debts')}
          </Text>
          <Text style={[Typography.bodyS, { color: c.textSecondary }]}>
            {t('account_delete.peers_note')}
          </Text>
        </View>

        {/* La misma información, en la web: es la que Google exige que exista
          * fuera de la app, y desde acá se puede compartir o leer sin la app. */}
        {LEGAL_DISPONIBLE && (
          <Pressable
            accessibilityRole="link"
            onPress={() => void Linking.openURL(urlDeBorrado())}
            style={styles.linkWeb}
          >
            <Ionicons name="open-outline" size={15} color={c.textTertiary} />
            <Text style={[Typography.bodyS, { color: c.textTertiary }]}>
              {t('account_delete.web')}
            </Text>
          </Pressable>
        )}

        <Pressable
          accessibilityRole="button"
          disabled={borrando}
          onPress={confirmar}
          style={[styles.boton, { borderColor: c.semantic.negative, opacity: borrando ? 0.6 : 1 }]}
        >
          <Ionicons name="trash-outline" size={17} color={c.semantic.negative} />
          <Text style={{ fontSize: 15, fontWeight: '700', color: c.semantic.negative }}>
            {borrando ? t('account_delete.working') : t('account_delete.confirm')}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Bloque({ titulo, color, children }: { titulo: string; color: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: Spacing[2] }}>
      <Text style={[Typography.bodyL, { color, fontWeight: '700' }]}>{titulo}</Text>
      {children}
    </View>
  );
}

function Linea({ texto, color }: { texto: string; color: string }) {
  return (
    <View style={styles.linea}>
      <Text style={[Typography.bodyS, { color }]}>{'•'}</Text>
      <Text style={[Typography.bodyS, { color, flex: 1 }]}>{texto}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: Spacing.screenPad,
    paddingTop: Spacing[4],
    paddingBottom: Spacing[6],
    gap: Spacing[5],
  },
  linea:  { flexDirection: 'row', gap: Spacing[2], alignItems: 'flex-start' },
  nota:   { borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.md, padding: Spacing[4], gap: Spacing[3] },
  linkWeb: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  boton:  {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing[2], paddingVertical: 14, borderRadius: Radius.md, borderWidth: 1,
    marginTop: Spacing[2],
  },
});
