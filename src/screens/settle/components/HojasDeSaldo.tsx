import React from 'react';
import { Text, type View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { HojaFecha } from '@/src/components/HojaFecha';
import { BottomSheet, SheetOption, SheetOptionAvatar } from '@/src/components/Sheet';
import { Typography } from '@/src/constants/typography';
import { useUserStore } from '@/src/store/userStore';
import { useColors } from '@/src/skins/useSkin';
import type { Group } from '@/src/types/models';

/**
 * Las cuatro hojas de Saldar: grupo, quién paga, quién recibe (estas dos sólo
 * sin precarga) y fecha. T-223: salió de `app/settle/new.tsx`.
 */
export function HojasDeSaldo({
  isPrefilled,
  showGroup, onCloseGroup, groups, groupId, onGroupChange,
  showFrom, onCloseFrom, members, fromId, onFromChange,
  showTo, onCloseTo, toOptions, toId, onToChange,
  showDate, onCloseDate, date, onDateChange,
  anclaFecha, hintDe,
}: {
  isPrefilled: boolean;
  showGroup: boolean;
  onCloseGroup: () => void;
  groups: Group[];
  groupId: string;
  onGroupChange: (id: string) => void;
  showFrom: boolean;
  onCloseFrom: () => void;
  members: string[];
  fromId: string;
  onFromChange: (id: string) => void;
  showTo: boolean;
  onCloseTo: () => void;
  toOptions: string[];
  toId: string;
  onToChange: (id: string) => void;
  showDate: boolean;
  onCloseDate: () => void;
  date: Date;
  onDateChange: (d: Date) => void;
  /** La fila de fecha de la pantalla: de ahí sale la fila de cubos en Aero. */
  anclaFecha: React.RefObject<View | null>;
  hintDe: (uid: string) => string | undefined;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const getUserName = useUserStore(s => s.getUserName);

  return (
    <>
      {/* Group picker */}
      <BottomSheet visible={showGroup} onClose={onCloseGroup}>
        <Text style={[Typography.h3, { color: c.text, marginBottom: 16 }]}>{t('expense.select_group')}</Text>
        {groups.map(g => (
          <SheetOption
            key={g.id}
            icon="people-outline"
            label={g.name}
            selected={g.id === groupId}
            onPress={() => onGroupChange(g.id)}
          />
        ))}
      </BottomSheet>

      {/* From picker — only when not prefilled */}
      {!isPrefilled && (
        <BottomSheet visible={showFrom} onClose={onCloseFrom}>
          <Text style={[Typography.h3, { color: c.text, marginBottom: 16 }]}>{t('expense.who_paid')}</Text>
          {members.map(uid => (
            <SheetOptionAvatar
              key={uid}
              userId={uid}
              name={getUserName(uid)}
              hint={hintDe(uid)}
              selected={uid === fromId}
              onPress={() => onFromChange(uid)}
            />
          ))}
        </BottomSheet>
      )}

      {/* To picker — only when not prefilled */}
      {!isPrefilled && (
        <BottomSheet visible={showTo} onClose={onCloseTo}>
          <Text style={[Typography.h3, { color: c.text, marginBottom: 16 }]}>{t('settle.who_received')}</Text>
          {toOptions.map(uid => (
            <SheetOptionAvatar
              key={uid}
              userId={uid}
              name={getUserName(uid)}
              hint={hintDe(uid)}
              selected={uid === toId}
              onPress={() => onToChange(uid)}
            />
          ))}
        </BottomSheet>
      )}

      <HojaFecha
        visible={showDate} onClose={onCloseDate} ancla={anclaFecha} date={date} onElegir={onDateChange}
        titulo={t('settle.payment_date')} testID="selector-fecha-saldo"
      />
    </>
  );
}
