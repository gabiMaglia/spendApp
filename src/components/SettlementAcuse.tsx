import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { ActionButton } from './ActionButton';
import { ButtonRack } from './ButtonRack';
import type { EstadoSaldado } from '@/src/algorithms/settlementStatus';

export interface SettlementAcuseProps {
  estado: EstadoSaldado;
  /** Me toca decidir: soy quien cobra y todavía no acusé. */
  meToca: boolean;
  /** Nombre de quien cobra, para contarle al resto a quién se espera. */
  nombreDeQuienCobra: string;
  onConfirmar: () => void;
  onRechazar: () => void;
  testID?: string;
}

/**
 * **El estado de un saldado que espera acuse** (T-064 · tramo C).
 *
 * Tres públicos distintos y tres mensajes distintos, y por eso es un componente
 * y no un chip:
 *
 *  - **quien cobra, mientras no decidió** — las dos acciones, y nada más;
 *  - **todos los demás, mientras tanto** — a quién se está esperando. Sin esto,
 *    quien pagó ve su deuda en cero y no sabe que el otro todavía no la dio por
 *    recibida, que es justo lo que D1 no quiere ocultar;
 *  - **cuando lo rechazaron** — dicho para los dos lados, porque la deuda
 *    volvió y el que pagó tiene que entender por qué.
 *
 * Un saldado `efectivo` no dibuja nada: es el caso normal y no merece ruido.
 */
export function SettlementAcuse({
  estado, meToca, nombreDeQuienCobra, onConfirmar, onRechazar, testID,
}: SettlementAcuseProps) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const c = Colors[scheme];

  if (estado === 'efectivo') return null;

  if (estado === 'rechazado') {
    return (
      <View
        testID={testID ? `${testID}-rechazado` : undefined}
        style={[styles.aviso, { backgroundColor: c.semantic.negativeSoft }]}
      >
        <Ionicons name="close-circle-outline" size={14} color={c.semantic.negative} />
        <Text style={[Typography.bodyS, { color: c.semantic.negative, flex: 1 }]}>
          {t('settlement.rejected', { name: nombreDeQuienCobra })}
        </Text>
      </View>
    );
  }

  if (!meToca) {
    return (
      <View
        testID={testID ? `${testID}-esperando` : undefined}
        style={[styles.aviso, { backgroundColor: c.surfaceSunken }]}
      >
        <Ionicons name="time-outline" size={14} color={c.textTertiary} />
        <Text style={[Typography.bodyS, { color: c.textTertiary, flex: 1 }]}>
          {t('settlement.waiting', { name: nombreDeQuienCobra })}
        </Text>
      </View>
    );
  }

  return (
    <View testID={testID ? `${testID}-decidir` : undefined} style={styles.decidir}>
      <Text style={[Typography.bodyS, { color: c.textSecondary }]}>
        {t('settlement.did_you_receive')}
      </Text>
      <ButtonRack direction="row">
        <ActionButton
          testID={testID ? `${testID}-confirmar` : undefined}
          size="sm"
          variant="primary"
          label={t('settlement.confirm')}
          action={onConfirmar}
        />
        <ActionButton
          testID={testID ? `${testID}-rechazar` : undefined}
          size="sm"
          variant="danger"
          label={t('settlement.reject')}
          action={onRechazar}
        />
      </ButtonRack>
    </View>
  );
}

const styles = StyleSheet.create({
  aviso: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: Spacing[3], paddingVertical: 5,
    borderRadius: Radius.full, marginTop: 6,
  },
  decidir: { gap: 6, marginTop: 8 },
});
