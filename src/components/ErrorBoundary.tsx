import React, { Component, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { recordError } from '@/src/services/errorLog';

/**
 * **Lo que hoy es una pantalla blanca** (T-078 · §5.2).
 *
 * Antes de esto no había ningún límite de error en el árbol: un error de render
 * en cualquier pantalla se llevaba la app entera, y en producción eso es una
 * pantalla en blanco sin camino de vuelta salvo cerrar y reabrir. No quedaba
 * rastro tampoco.
 *
 * Ahora el error se contiene, se anota, y el usuario tiene un botón para volver.
 *
 * ⚠️ **Ni un `t()` acá adentro.** Los textos llegan ya traducidos por props. Si
 * lo que falló fue i18n —y es un candidato tan bueno como cualquiera—, un `t()`
 * en la pantalla de error la tumbaría a ella también, y ahí sí no queda nada:
 * un límite de error que se cae es peor que no tenerlo, porque el error real se
 * pierde detrás del segundo.
 *
 * **`componentDidCatch` y no `getDerivedStateFromError` para anotar:** el
 * segundo corre durante el render y tiene que ser puro. Escribir en storage
 * desde ahí es un efecto en medio del render, y React puede llamarlo dos veces.
 */

export type TextosDeError = {
  title: string;
  body: string;
  retry: string;
  /** Si falta, no se ofrece exportar. */
  exportar?: string;
};

type Props = {
  children: ReactNode;
  textos: TextosDeError;
  onExport?: () => void;
};

type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    recordError({
      message: error?.message ?? String(error),
      // El stack de componentes dice QUÉ pantalla se cayó, que es lo primero
      // que se busca; el de JS dice dónde. Se guarda el de JS y, si no hay, el
      // de componentes — nunca los dos, para no duplicar kilobytes.
      stack: error?.stack ?? info?.componentStack ?? undefined,
      fatal: true,
    });
  }

  private reintentar = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error === null) return this.props.children;

    return (
      <PantallaDeError
        textos={this.props.textos}
        onRetry={this.reintentar}
        onExport={this.props.onExport}
      />
    );
  }
}

/**
 * La pantalla en sí, aparte y funcional: así puede usar el hook del tema sin
 * que el límite de error tenga que recibir una paleta entera por props.
 */
function PantallaDeError({
  textos, onRetry, onExport,
}: {
  textos: TextosDeError;
  onRetry: () => void;
  onExport?: () => void;
}) {
  const c = Colors[useColorScheme() ?? 'light'];

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <Text style={[Typography.h3, styles.centro, { color: c.text }]}>{textos.title}</Text>
      <Text style={[Typography.bodyM, styles.centro, { color: c.textSecondary }]}>{textos.body}</Text>

      <Pressable
        onPress={onRetry}
        style={[styles.boton, { backgroundColor: c.surface, borderColor: c.hair }]}
      >
        <Text style={[Typography.bodyL, { color: c.text, fontWeight: '700' }]}>{textos.retry}</Text>
      </Pressable>

      {onExport && textos.exportar ? (
        <Pressable onPress={onExport} style={styles.link}>
          <Text style={[Typography.bodyM, { color: c.textSecondary }]}>{textos.exportar}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: Spacing.screenPad,
  },
  centro: { textAlign: 'center' },
  boton: {
    marginTop: 10,
    paddingVertical: 14,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  link: { paddingVertical: 10, alignItems: 'center' },
});
