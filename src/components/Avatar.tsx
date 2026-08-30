import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Colors } from '@/src/constants/colors';
import { useColorScheme } from '@/hooks/use-color-scheme';

const AVATAR_HUES: [string, string][] = [
  ['#E8965A', '#FFFFFF'],
  ['#4D9FD6', '#FFFFFF'],
  ['#8B7CC4', '#FFFFFF'],
  ['#D4729C', '#FFFFFF'],
  ['#4DAA9E', '#FFFFFF'],
  ['#D4A848', '#1F1A14'],
  ['#6FA075', '#FFFFFF'],
  ['#C45447', '#FFFFFF'],
];

interface AvatarProps {
  name: string;
  size?: number;
  hue?: number;
  ring?: string;
  /**
   * Foto en data URI. Si falta —o si falla al dibujarse— se cae a las
   * iniciales, que es lo que ya funcionaba.
   *
   * NO se ofrece verla en grande (decisión del PO): es un identificador visual
   * en una lista, no una galería.
   */
  photo?: string;
}

export function Avatar({ name, size = 36, hue = 0, ring, photo }: AvatarProps) {
  const [bg, fg] = AVATAR_HUES[hue % AVATAR_HUES.length]!;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map(s => s[0]?.toUpperCase() ?? '')
    .join('') || '?';

  return (
    <View
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg,
          ...(ring ? { borderWidth: 2, borderColor: ring } : {}),
        },
      ]}
    >
      {photo ? (
        <Image
          source={{ uri: photo }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          // La foto es un cuadrado ya recortado por `achicarAAvatar`; `cover`
          // evita que una imagen no cuadrada se deforme.
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Text style={{ color: fg, fontSize: Math.round(size * 0.4), fontWeight: '600' }}>
          {initials}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});

// ── AvatarStack ──────────────────────────────────────────────────────────────

interface AvatarStackProps {
  people: { name: string; hue?: number }[];
  size?: number;
  max?: number;
  ring?: string;
}

export function AvatarStack({ people, size = 28, max = 4, ring }: AvatarStackProps) {
  const scheme = useColorScheme() ?? 'light';
  const defaultRing = ring ?? Colors[scheme].surface;
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {shown.map((p, i) => (
        <View key={i} style={{ marginLeft: i === 0 ? 0 : -Math.round(size * 0.3) }}>
          <Avatar name={p.name} hue={p.hue ?? i} size={size} ring={defaultRing} />
        </View>
      ))}
      {extra > 0 && (
        <View
          style={{
            marginLeft: -Math.round(size * 0.3),
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: Colors[scheme].surfaceSunken,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 2,
            borderColor: defaultRing,
          }}
        >
          <Text style={{ color: Colors[scheme].textSecondary, fontSize: Math.round(size * 0.35), fontWeight: '600' }}>
            +{extra}
          </Text>
        </View>
      )}
    </View>
  );
}
