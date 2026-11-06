import React from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { lecturaDeSaldo } from '@/src/algorithms/lecturaDeSaldo';
import { Band, useC } from '@/src/components/band/BandBase';
import { MontoRodante } from '@/src/components/MontoRodante';
import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { formatMoney, type CurrencyCode } from '@/src/constants/currencies';
import type { MontoRegistry } from '@/src/utils/montoRodanteRegistry';

/**
 * **Saldo neto con desglose** (PO 2026-11-06, opción A). El número grande es
 * te deben − debés; debajo, en chico, los dos brutos sin compensar (T-225).
 * Reemplaza los dos casilleros iguales de Personal, Grupos y el detalle de
 * grupo, que hacían leer «224k y 120k» donde la respuesta era «103k a favor».
 *
 * Va sobre `Band`, así que cada skin la dibuja a su manera: banda con
 * hairlines en Clásico, tarjeta suelta en Aero.
 *
 * Debés nunca va en rojo (pedido del PO): el tono «en contra» usa el gris
 * secundario, igual que el casillero que reemplaza.
 */
export function SaldoNeto({
  owedToYou, youOwe, code, contraparte, ids, noTop, registry, pending, pendingLabel,
}: {
  owedToYou: number;
  youOwe: number;
  code: CurrencyCode;
  /** Con UNA sola contraparte (grupo de dos), la etiqueta la nombra. */
  contraparte?: string;
  /** Con ids, los montos ruedan (`MontoRodante`), como los casilleros de antes. */
  ids?: { neto: string; owedToYou: string; youOwe: string };
  noTop?: boolean;
  /** Sólo para tests: registro inyectable de `MontoRodante`. */
  registry?: MontoRegistry;
  /**
   * Conversión de moneda en curso (T-109, Amigos): los montos muestran `--`
   * en vez de animar hacia un total parcial. Sólo con `ids`.
   */
  pending?: boolean;
  /** Texto ya traducido para el placeholder de `pending`. */
  pendingLabel?: string;
}) {
  const { t } = useTranslation();
  const c = useC();
  const { tono, neto, desglose } = lecturaDeSaldo(owedToYou, youOwe);

  const etiqueta =
    tono === 'saldado' ? t('common.settled')
    : tono === 'favor'
      ? (contraparte ? t('groups.net_they_owe_you', { name: contraparte }) : t('groups.net_in_favor'))
      : (contraparte ? t('groups.net_you_owe_them', { name: contraparte }) : t('groups.net_against'));
  const colorNeto = tono === 'favor' ? c.semantic.positive : tono === 'contra' ? c.textSecondary : c.text;

  const monto = (minor: number, id: string | undefined, style: object, testID?: string) =>
    id ? (
      <MontoRodante
        id={id} minor={minor} code={code} style={style} registry={registry}
        pending={pending} pendingAccessibilityLabel={pendingLabel}
      />
    ) : (
      <Text testID={testID} style={style} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
        {formatMoney(minor, code)}
      </Text>
    );

  const etiquetaChica = [Typography.label, { color: c.textTertiary, textTransform: 'uppercase' as const }];

  return (
    <Band noTop={noTop}>
      <View testID="saldo-neto" style={{ paddingVertical: Spacing[4], paddingHorizontal: Spacing.screenPad }}>
        <Text style={etiquetaChica}>{etiqueta}</Text>
        {monto(neto, ids?.neto, [Typography.amountXL, { color: colorNeto }], 'saldo-neto-monto')}

        {desglose && (
          <View
            testID="saldo-neto-desglose"
            style={{
              flexDirection: 'row', gap: Spacing[3],
              marginTop: Spacing[3], paddingTop: Spacing[3],
              borderTopWidth: 1, borderTopColor: c.hair,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={etiquetaChica}>{t('groups.stat_owed_to_you')}</Text>
              {monto(owedToYou, ids?.owedToYou, [Typography.amountS, { color: c.semantic.positive }])}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={etiquetaChica}>{t('groups.stat_you_owe')}</Text>
              {monto(youOwe, ids?.youOwe, [Typography.amountS, { color: c.textSecondary }])}
            </View>
          </View>
        )}
      </View>
    </Band>
  );
}
