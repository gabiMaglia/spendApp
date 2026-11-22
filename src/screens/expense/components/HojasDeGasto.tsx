import React from 'react';
import type { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { HojaFecha } from '@/src/components/HojaFecha';
import { BottomSheet, SheetActions, SheetButton, SheetInput, SheetOption, SheetOptionAvatar } from '@/src/components/Sheet';
import { MAX_NOTA } from '@/src/sync/nucleo/topes';
import { useUserStore } from '@/src/store/userStore';
import type { Group } from '@/src/types/models';

/** Las de `HojasSplitwise` (pagadores, reparto, repetir) son sólo de Aero. */
export type HojaAbierta = 'grupo' | 'pagador' | 'fecha' | 'nota' | 'pagadores' | 'reparto' | 'repetir' | null;

/**
 * Las cuatro hojas de Nuevo gasto: grupo (sólo al crear), pagador, fecha y
 * nota. T-223: salió de `app/expense/new.tsx`.
 */
export function HojasDeGasto({
  abierta, onClose, isEditMode,
  groups, groupId, onGroupChange,
  members, payerId, onPayerChange,
  date, onDateChange, anclaFecha, soloMesCorriente = false,
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
  /** El chip de fecha de la barra: de ahí sale la fila de cubos en Aero. */
  anclaFecha: React.RefObject<View | null>;
  /** Gasto personal: un mes cerrado ya arrastró su saldo (T-259). */
  soloMesCorriente?: boolean;
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

      <HojaFecha
        visible={abierta === 'fecha'} onClose={onClose} ancla={anclaFecha} date={date} onElegir={onDateChange}
        titulo={t('expense.expense_date')} soloMesCorriente={soloMesCorriente} testID="selector-fecha"
      />

      <BottomSheet
        visible={abierta === 'nota'}
        onClose={onClose}
        title={t('expense.note')}
        scroll={false}
        footer={<SheetActions><SheetButton label={t('common.done')} onPress={onClose} /></SheetActions>}
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
