import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { wipeAllAccounts } from '@/src/store/wipeDevice';
import { Alert } from 'react-native';

/**
 * Diagnóstico del índice de identidad (solo DEV).
 *
 * Existe porque "sigo viendo dos cuentas" es un síntoma que se puede explicar de
 * varias formas —código viejo en el bundle, el índice vacío, el usuario eligió
 * "cuenta aparte"— y adivinar cuál sale caro. Acá se ve el estado real.
 */
export default function IdentityDebugScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const snapshot = useAuthStore(st => st.identitySnapshot)();
  const groups = useGroupStore(st => st.groups);
  const expenses = useExpenseStore(st => st.expenses);

  const dosCuentas = snapshot.known.length > 1;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="close" size={24} color={c.text} />
        </Pressable>
        <Text style={[Typography.h3, { color: c.text }]}>Identidad (DEV)</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Block title="CUENTA ACTIVA" c={c}>
          <Row label="accountId" value={snapshot.activeAccountId ?? '(sin sesión)'} c={c} />
          <Row label="grupos visibles" value={String(groups.length)} c={c} />
          <Row label="gastos visibles" value={String(expenses.length)} c={c} />
        </Block>

        <Block title={`CUENTAS CONOCIDAS EN ESTE DEVICE (${snapshot.known.length})`} c={c}>
          {snapshot.known.length === 0 ? (
            <Text style={[Typography.bodyS, { color: c.textTertiary }]}>
              El índice está vacío. Si ya entraste con algún proveedor después de
              actualizar, esto no debería estar vacío: significa que la app está
              corriendo código viejo (recargá con una sacudida → Reload).
            </Text>
          ) : (
            snapshot.known.map(a => {
              const perfil = snapshot.profiles.find(p => p.accountId === a.accountId);
              return (
                <View key={a.accountId} style={[styles.card, { borderColor: c.borderHair }]}>
                  <Row label="accountId" value={a.accountId} c={c} />
                  <Row label="nombre" value={perfil?.name ?? '—'} c={c} />
                  <Row
                    label="mail conocido"
                    value={a.email ?? '(NUNCA lo supimos)'}
                    c={c}
                    warn={a.email === undefined}
                  />
                  {a.accountId === snapshot.activeAccountId && (
                    <Text style={[Typography.bodyS, { color: c.semantic.positive }]}>← activa</Text>
                  )}
                </View>
              );
            })
          )}
        </Block>

        <Block title="EMPEZAR DE CERO" c={c}>
          <Text style={[Typography.bodyS, { color: c.textSecondary }]}>
            Borra todas las cuentas de este teléfono y sus datos, para poder
            probar el primer login sin desinstalar la app. El tema y el idioma
            no se tocan.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              Alert.alert(
                'Borrar todas las cuentas',
                'Se borran las cuentas de este dispositivo y TODOS sus gastos, grupos y pagos. No se puede deshacer.',
                [
                  { text: 'Cancelar', style: 'cancel' },
                  {
                    text: 'Borrar todo',
                    style: 'destructive',
                    onPress: () => {
                      wipeAllAccounts();
                      router.replace('/auth');
                    },
                  },
                ],
              );
            }}
            style={[styles.card, { borderColor: c.semantic.negative, alignItems: 'center' }]}
          >
            <Text style={[Typography.bodyM, { color: c.semantic.negative, fontWeight: '700' }]}>
              Borrar todas las cuentas y datos
            </Text>
          </Pressable>
        </Block>

        {dosCuentas && (
          <View style={[styles.card, { borderColor: c.semantic.negative }]}>
            <Text style={[Typography.bodyM, { color: c.semantic.negative, fontWeight: '600' }]}>
              Hay {snapshot.known.length} cuentas separadas
            </Text>
            <Text style={[Typography.bodyS, { color: c.textSecondary }]}>
              Si sos la misma persona, al entrar con el otro proveedor la app tiene
              que preguntarte si querés unirlas. Si NO te preguntó, mandale esta
              pantalla al equipo: con los mails de arriba se sabe por qué.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Block({ title, c, children }: { title: string; c: any; children: React.ReactNode }) {
  return (
    <View style={{ gap: Spacing[2] }}>
      <Text style={[Typography.label, { color: c.textSecondary }]}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, value, c, warn }: { label: string; value: string; c: any; warn?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[Typography.bodyS, { color: c.textTertiary }]}>{label}</Text>
      <Text
        selectable
        style={[Typography.bodyS, styles.value, { color: warn ? c.semantic.negative : c.text }]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], padding: Spacing.screenPad },
  scroll: { padding: Spacing.screenPad, gap: Spacing[6] },
  card:   { borderWidth: 1, borderRadius: Radius.md, padding: Spacing[3], gap: 4 },
  row:    { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing[3] },
  value:  { flexShrink: 1, textAlign: 'right', fontWeight: '600' },
});
