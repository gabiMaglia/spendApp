import React from 'react';
import { useTranslation } from 'react-i18next';

import { Segmented } from '@/src/components/Band';

/**
 * Gasto | Ingreso arriba del alta, sólo desde Personal (feat/reskin, B4 — PO
 * eligió «segmentado arriba»). El haptic lo da `Segmented`.
 */
export function SelectorDeTipo({
  isIncome, onChange,
}: { isIncome: boolean; onChange: (k: 'expense' | 'income') => void }) {
  const { t } = useTranslation();
  return (
    <Segmented<'expense' | 'income'>
      variant="tabs"
      value={isIncome ? 'income' : 'expense'}
      onChange={onChange}
      options={[
        { key: 'expense', label: t('expense.kind_expense'), icon: 'trending-down-outline' },
        { key: 'income',  label: t('expense.kind_income'),  icon: 'trending-up-outline' },
      ]}
    />
  );
}
