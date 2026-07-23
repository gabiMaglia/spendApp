import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { runWebRTCLoopbackSpike, type SpikeResult } from '@/src/p2p/webrtcLoopbackSpike';

// Pantalla de spike (dev): valida que react-native-webrtc funciona en el build
// nativo con un DataChannel loopback ping→pong. No es UI de producción.
export default function WebRTCSpikeScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SpikeResult | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  async function run() {
    setRunning(true);
    setResult(null);
    setLogs([]);
    const append = (line: string) => setLogs(prev => [...prev, line]);
    try {
      const r = await runWebRTCLoopbackSpike(append);
      setResult(r);
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setRunning(false);
    }
  }

  const bannerColor = !result ? c.surfaceSunken
    : result.ok ? c.semantic.positiveSoft
    : c.semantic.negativeSoft;
  const bannerText = !result ? c.textTertiary
    : result.ok ? c.semantic.positiveOnSoft
    : c.semantic.negativeOnSoft;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <View style={[styles.header, { borderBottomColor: c.borderHair }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="close" size={24} color={c.text} />
        </Pressable>
        <Text style={[Typography.h3, { color: c.text }]}>WebRTC spike</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[Typography.bodyS, { color: c.textSecondary }]}>
          Valida react-native-webrtc con un DataChannel loopback (dos peers en la misma app,
          ping→pong, sin red ni signaling). Si sale ✅, la pieza nativa anda y podemos construir el sync real.
        </Text>

        <Pressable
          onPress={run}
          disabled={running}
          style={[styles.btn, { backgroundColor: running ? c.surfaceSunken : c.brand.primary }]}
        >
          <Text style={[Typography.bodyL, { color: running ? c.textTertiary : '#fff', fontWeight: '700' }]}>
            {running ? 'Corriendo…' : 'Correr spike'}
          </Text>
        </Pressable>

        {result && (
          <View style={[styles.banner, { backgroundColor: bannerColor }]}>
            <Text style={[Typography.bodyM, { color: bannerText, fontWeight: '600' }]}>
              {result.message}
            </Text>
          </View>
        )}

        {logs.length > 0 && (
          <View style={[styles.logBox, { backgroundColor: c.surfaceSunken, borderColor: c.borderHair }]}>
            {logs.map((line, i) => (
              <Text key={i} style={[Typography.caption, { color: c.textSecondary }]}>
                {`› ${line}`}
              </Text>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  scroll: { padding: Spacing.screenPad, gap: Spacing[4] },
  btn:    { paddingVertical: 16, borderRadius: Radius.lg, alignItems: 'center' },
  banner: { padding: Spacing[4], borderRadius: Radius.lg },
  logBox: { padding: Spacing[4], borderRadius: Radius.lg, borderWidth: 1, gap: 4 },
});
