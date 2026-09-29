import React from 'react';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { hapticLight } from '@/src/utils/haptics';
import { Fab, FabRow } from '@/src/components/Fab';
import { useColors } from '@/src/skins/useSkin';

/**
 * Botonera flotante: «Saldar deuda» (sólo con deuda viva mía, T-104/T-113) y
 * «Agregar gasto». T-223: salió de `app/groups/[id].tsx`.
 */
export function BotonesDeGrupo({
  groupId, tieneDeudaViva,
}: {
  groupId: string;
  tieneDeudaViva: boolean;
}) {
  const { t } = useTranslation();
  const c = useColors();

  return (
    <FabRow>
      {tieneDeudaViva && (
        <Fab
          testID="settle-debts"
          variant="secondary"
          icon="swap-horizontal-outline"
          label={t('group_detail.settle_debts')}
          onPress={() => { hapticLight(); router.push(`/settle/new?groupId=${groupId}` as any); }}
          backgroundColor={c.brand.primarySoft}
          borderColor={c.hair}
          iconColor={c.brand.primary}
          textColor={c.brand.primary}
        />
      )}
      <Fab
        testID="add-expense"
        icon="add"
        label={t('group_detail.add_expense')}
        onPress={() => {
          hapticLight();
          router.push({ pathname: '/expense/new', params: { groupId } } as any);
        }}
        backgroundColor={c.brand.primary}
      />
    </FabRow>
  );
}
