import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform } from 'react-native';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  sendEnvelope, fetchSince, subscribeTopic, isRelayConfigured, type Envelope,
} from '@/src/sync/relay';

/**
 * Spike del relay (solo DEV): probar el buzón store-and-forward entre dos
 * dispositivos, SIN cifrado todavía.
 *
 * Lo que hay que ver funcionando acá antes de meter criptografía:
 *  1. Mando desde un aparato y llega al otro **al instante** (push realtime).
 *  2. Cierro la app del otro, mando, la reabro: **el sobre estaba encolado**.
 *     Esto es lo que WebRTC no puede hacer y motivó todo el ADR-003.
 *  3. El push es sólo un aviso: la lectura siempre va por cursor, así que si el
 *     websocket se cayó, la próxima lectura recupera igual.
 */
export default function RelayDebugScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const [topic, setTopic] = useState('spike');
  const [text, setText] = useState('');
  const [inbox, setInbox] = useState<Envelope[]>([]);
  const [status, setStatus] = useState('—');
  const cursor = useRef(0);

  // Id de dispositivo para no reprocesar lo propio. En el spike alcanza con
  // distinguir plataforma; en producción sale del roster.
  const deviceId = useRef(`${Platform.OS}-${Math.random().toString(36).slice(2, 7)}`).current;

  const drain = useCallback(async () => {
    const r = await fetchSince(topic, cursor.current, deviceId);
    if (!r.ok) { setStatus(`error al leer: ${r.reason}`); return; }
    if (r.envelopes.length > 0) {
      setInbox(prev => [...prev, ...r.envelopes]);
      // El cursor se avanza DESPUÉS de aplicar: si se guardara antes y la app
      // muriera en el medio, esos sobres no se volverían a pedir nunca.
      cursor.current = r.cursor;
      setStatus(`${r.envelopes.length} sobre(s) nuevos · cursor ${r.cursor}`);
    } else {
      setStatus(`sin novedades · cursor ${cursor.current}`);
    }
  }, [topic, deviceId]);

  useEffect(() => {
    setInbox([]);
    cursor.current = 0;
    void drain();                              // al entrar: drenar lo encolado
    const off = subscribeTopic(topic, drain);  // y después, escuchar avisos
    return off;
  }, [topic, drain]);

  async function handleSend() {
    if (!text.trim()) return;
    setStatus('enviando…');
    const r = await sendEnvelope(topic, text.trim(), deviceId);
    setStatus(r.ok ? `enviado · seq ${r.seq}` : `error: ${r.reason}${r.detail ? ` — ${r.detail}` : ''}`);
    if (r.ok) setText('');
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="close" size={24} color={c.text} />
        </Pressable>
        <Text style={[Typography.h3, { color: c.text }]}>Relay (DEV)</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.card, { borderColor: c.borderHair }]}>
          <Row label="relay" value={isRelayConfigured() ? 'configurado' : 'SIN CONFIGURAR'} c={c} />
          <Row label="este device" value={deviceId} c={c} />
          <Row label="estado" value={status} c={c} />
        </View>

        <Text style={[Typography.label, { color: c.textSecondary }]}>TOPIC (igual en los dos aparatos)</Text>
        <TextInput
          value={topic}
          onChangeText={setTopic}
          autoCapitalize="none"
          style={[Typography.bodyM, styles.input, { color: c.text, backgroundColor: c.surface, borderColor: c.borderHair }]}
        />

        <Text style={[Typography.label, { color: c.textSecondary }]}>ENVIAR UN SOBRE</Text>
        <View style={styles.sendRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="texto de prueba"
            placeholderTextColor={c.textTertiary}
            style={[Typography.bodyM, styles.input, { flex: 1, color: c.text, backgroundColor: c.surface, borderColor: c.borderHair }]}
          />
          <Pressable
            accessibilityRole="button"
            onPress={handleSend}
            style={[styles.btn, { backgroundColor: c.brand.primary }]}
          >
            <Ionicons name="send" size={18} color={c.textOnBrand} />
          </Pressable>
        </View>

        <Pressable onPress={drain} style={[styles.card, { borderColor: c.borderHair, alignItems: 'center' }]}>
          <Text style={[Typography.bodyM, { color: c.brand.primary, fontWeight: '600' }]}>
            Leer pendientes (forzar drenaje)
          </Text>
        </Pressable>

        <Text style={[Typography.label, { color: c.textSecondary }]}>RECIBIDOS ({inbox.length})</Text>
        {inbox.length === 0 ? (
          <Text style={[Typography.bodyS, { color: c.textTertiary }]}>
            Nada todavía. Mandá algo desde el otro aparato con el mismo topic.
          </Text>
        ) : (
          inbox.map(e => (
            <View key={e.seq} style={[styles.card, { borderColor: c.borderHair }]}>
              <Row label={`seq ${e.seq}`} value={e.payload} c={c} />
              <Row label="de" value={e.sender} c={c} />
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, c }: { label: string; value: string; c: any }) {
  return (
    <View style={styles.row}>
      <Text style={[Typography.bodyS, { color: c.textTertiary }]}>{label}</Text>
      <Text selectable style={[Typography.bodyS, styles.value, { color: c.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1 },
  header:  { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], padding: Spacing.screenPad },
  scroll:  { padding: Spacing.screenPad, gap: Spacing[3] },
  card:    { borderWidth: 1, borderRadius: Radius.md, padding: Spacing[3], gap: 4 },
  row:     { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing[3] },
  value:   { flexShrink: 1, textAlign: 'right', fontWeight: '600' },
  input:   { borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: Spacing[3], paddingVertical: Spacing[2] },
  sendRow: { flexDirection: 'row', gap: Spacing[2], alignItems: 'center' },
  btn:     { borderRadius: Radius.md, padding: Spacing[3] },
});
