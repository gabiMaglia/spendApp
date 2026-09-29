import React from 'react';
import { useTranslation } from 'react-i18next';

import { BottomSheet, SheetButton, SheetInput, SheetOption, SheetOptionAvatar } from '@/src/components/Sheet';
import { MAX_NOTA } from '@/src/sync/nucleo/topes';
import { useUserStore } from '@/src/store/userStore';
import type { Group } from '@/src/types/models';
import { formatDate } from '@/src/screens/expense/repartoDeGasto';

export type HojaAbierta = 'grupo' | 'pagador' | 'fecha' | 'nota' | null;

/**
 * Las cuatro hojas de Nuevo gasto: grupo (sólo al crear), pagador, fecha y
 * nota. T-223: salió de `app/expense/new.tsx`.
 */
export function HojasDeGasto({
  abierta, onClose, isEditMode,
  groups, groupId, onGroupChange,
  members, payerId, onPayerChange,
  date, onDateChange,
  note, onNoteChange,
}: {
  abierta: HojaAbierta;
  onClose: () => void;
  isEditMode: boolean;
  groups: Group[];
  groupId: string;
  onGroupChange: (id: string) => void;
  members: string[];
  payerId: string;
  onPayerChange: (id: string) => void;
  date: Date;
  onDateChange: (d: Date) => void;
  note: string;
  onNoteChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  const getUserName = useUserStore(s => s.getUserName);

  return (
    <>
      {/* Group picker — only shown in create mode */}
      {!isEditMode && (
        <BottomSheet visible={abierta === 'grupo'} onClose={onClose} title={t('expense.select_group')}>
          <SheetOption
            icon="person-outline"
            label={t('expense.no_group')}
            selected={groupId === ''}
            onPress={() => onGroupChange('')}
            last={groups.length === 0}
          />
          {groups.map((g, i) => (
            <SheetOption
              key={g.id}
              icon="people-outline"
              label={g.name}
              selected={g.id === groupId}
              onPress={() => onGroupChange(g.id)}
              last={i === groups.length - 1}
            />
          ))}
        </BottomSheet>
      )}

      <BottomSheet visible={abierta === 'pagador'} onClose={onClose} title={t('expense.who_paid')}>
        {members.map((userId, i) => (
          <SheetOptionAvatar
            key={userId}
            userId={userId}
            name={getUserName(userId)}
            selected={userId === payerId}
            onPress={() => { onPayerChange(userId); onClose(); }}
            last={i === members.length - 1}
          />
        ))}
      </BottomSheet>

      <BottomSheet visible={abierta === 'fecha'} onClose={onClose} title={t('expense.expense_date')}>
        {Array.from({ length: 7 }, (_, i) => {
          const d = new Date();
          d.setDate(d.getDate() - i);
          d.setHours(12, 0, 0, 0);
          const label   = formatDate(d);
          const longFmt = i > 1 ? d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }) : undefined;
          const isSel   = formatDate(date) === label;
          return (
            <SheetOption
              key={i}
              icon="calendar-outline"
              label={label}
              sublabel={longFmt}
              selected={isSel}
              onPress={() => { onDateChange(d); onClose(); }}
              last={i === 6}
            />
          );
        })}
      </BottomSheet>

      <BottomSheet
        visible={abierta === 'nota'}
        onClose={onClose}
        title={t('expense.note')}
        scroll={false}
        footer={<SheetButton label={t('common.done')} onPress={onClose} />}
      >
        <SheetInput
          value={note}
          onChangeText={onNoteChange}
          maxLength={MAX_NOTA}
          placeholder={t('expense.note_placeholder')}
          multiline
          numberOfLines={4}
        />
      </BottomSheet>
    </>
  );
}
