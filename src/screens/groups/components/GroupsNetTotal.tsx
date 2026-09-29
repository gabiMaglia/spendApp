import React from 'react';
import { useTranslation } from 'react-i18next';

import { FilaDeTotal } from '@/src/components/FilaDeTotal';
import type { CurrencyCode } from '@/src/constants/currencies';

/**
 * "Total" (PO 2026-09-22): la sumatoria neta de los grupos QUE SE VEN AHORA —
 * cuenta separada para activos y archivados, cambia con la pestaña. Distinto
 * de los 4 casilleros de arriba, que son fijos.
 *
 * La etiqueta arranca alineada con el NOMBRE de cada grupo de arriba, no con
 * el borde de la pantalla (PO 2026-09-22): mismo offset que `GroupCard`
 * (tile 38 + gap 13), para que "Total" se lea como el pie de la lista.
 */
const SANGRIA_GROUP_CARD = 38 + 13;

export function GroupsNetTotal({ netTotal, cur }: { netTotal: number; cur: CurrencyCode }) {
  const { t } = useTranslation();
  return (
    <FilaDeTotal
      testID="groups-net-total"
      label={t('groups.stat_net_total')}
      minor={netTotal}
      code={cur}
      montoId="groups.netTotal"
      sangria={SANGRIA_GROUP_CARD}
    />
  );
}
