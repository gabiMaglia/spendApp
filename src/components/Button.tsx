import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps } from 'react-native';
import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost' | 'soft';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<PressableProps, 'style'> {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  loading?: boolean;
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  block,
  loading,
  disabled,
  ...rest
}: ButtonProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const variantStyle = {
    primary:     { bg: c.brand.primary,     fg: c.textOnBrand },
    secondary:   { bg: c.surface,           fg: c.text,       border: c.borderStrong },
    destructive: { bg: c.semantic.negative, fg: '#fff' },
    ghost:       { bg: 'transparent',       fg: c.brand.primary },
    soft:        { bg: c.brand.primarySoft, fg: c.brand.primaryOnSoft },
  }[variant];

  const sizeStyle = {
    sm: { height: 36, px: 14, fs: 14, radius: Radius.sm },
    md: { height: 44, px: 18, fs: 15, radius: Radius.md },
    lg: { height: 52, px: 22, fs: 17, radius: Radius.md },
  }[size];

  return (
    <Pressable
      {...rest}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        {
          height: sizeStyle.height,
          paddingHorizontal: sizeStyle.px,
          borderRadius: sizeStyle.radius,
          backgroundColor: variantStyle.bg,
          width: block ? '100%' : undefined,
          opacity: pressed || disabled ? 0.7 : 1,
          ...(variantStyle.border ? { borderWidth: 1, borderColor: variantStyle.border } : {}),
        },
      ]}
    >
      {loading
        ? <ActivityIndicator color={variantStyle.fg} size="small" />
        : <Text style={{ color: variantStyle.fg, fontSize: sizeStyle.fs, fontWeight: '600', letterSpacing: -0.1 }}>
            {children}
          </Text>
      }
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
