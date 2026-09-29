import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { hapticSuccess } from '@/src/utils/haptics';
import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { Band, BandRow, SectionLabel } from '@/src/components/Band';
import { useGroupStore } from '@/src/store/groupStore';
import { yaAprobo, approvalProgress } from '@/src/algorithms/leaveRequest';
import { verifyLeaveApproval } from '@/src/sync/confianza/leaveApprovalSign';
import { authorKeysFor } from '@/src/sync/confianza/authorKeys';
import { applyApprovedLeaves } from '@/src/services/applyLeave';
import { esYo } from '@/src/store/identityAlias';
import { useColors } from '@/src/skins/useSkin';
import type { Group } from '@/src/types/models';

/**
 * Pedido de salida pendiente: quien pidió salir puede retirarlo; el resto lo
 * aprueba. Sólo se monta con `group.leaveRequest` presente.
 * T-223: salió de `app/groups/[id].tsx`.
 */
export function PedidoDeSalida({
  group, currentUserId, getUserName,
}: {
  group: Group;
  currentUserId: string;
  getUserName: (id: string) => string;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const approveLeave = useGroupStore(st => st.approveLeave);
  const cancelLeave  = useGroupStore(st => st.cancelLeave);

  /**
   * El «2 de 3» cuenta las aprobaciones que VERIFICAN (T-065), igual que el que
   * decide aplicar la salida. Si contara las crudas, un pedido con aprobaciones
   * forjadas mostraría «3 de 3» y no pasaría nada nunca — el peor de los
   * mundos: la pantalla diciendo que está listo y la app sin moverse.
   *
   * Se memoiza contra el pedido: son como mucho tantas verificaciones como
   * miembros, y sólo mientras hay una salida pendiente.
   */
  const avance = useMemo(() => {
    if (!group?.leaveRequest) return { got: 0, need: 0 };
    return approvalProgress(group, group.leaveRequest, a =>
      verifyLeaveApproval(group.id, group.leaveRequest!, a, authorKeysFor(a.userId, a.k)) === 'valida',
    );
  }, [group]);

  if (!group.leaveRequest) return null;
  const pedido = group.leaveRequest;

  return (
    <>
      <SectionLabel label={t('leave.title')} />
      <Band>
        <View style={[styles.leaveNote, { backgroundColor: c.semantic.warningSoft }]}>
          <Ionicons name="warning-outline" size={15} color={c.semantic.warning} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[Typography.bodyS, { color: c.semantic.warning, fontWeight: '700' }]}>
              {esYo(pedido.userId)
                ? t('leave.pending_mine', { got: avance.got, need: avance.need })
                : t('leave.pending_title', { name: getUserName(pedido.userId) })}
            </Text>
            {!esYo(pedido.userId) && (
              <Text style={[Typography.caption, { color: c.semantic.warning }]}>
                {t('leave.pending_body', { got: avance.got, need: avance.need })}
              </Text>
            )}
          </View>
        </View>

        {esYo(pedido.userId) ? (
          <BandRow onPress={() => cancelLeave(group.id)} last>
            <Text style={[Typography.bodyL, { color: c.textSecondary, flex: 1, textAlign: 'center' }]}>
              {t('leave.withdraw')}
            </Text>
          </BandRow>
        ) : !yaAprobo(pedido, currentUserId) && (
          <BandRow
            last
            onPress={() => {
              hapticSuccess();
              approveLeave(group.id, currentUserId);
              applyApprovedLeaves();
            }}
          >
            <View style={styles.approveRow}>
              <Ionicons name="checkmark-circle-outline" size={18} color={c.brand.primary} />
              <Text style={[Typography.bodyL, { color: c.brand.primary }]}>{t('leave.approve')}</Text>
            </View>
          </BandRow>
        )}
      </Band>
    </>
  );
}

const styles = StyleSheet.create({
  leaveNote:  {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9,
    paddingHorizontal: Spacing.screenPad, paddingVertical: 13,
  },
  approveRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});
