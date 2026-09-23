import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';

import { usePersonalStore } from '@/src/store/personalStore';
import { reasonKey } from '@/src/algorithms/entryOrigin';
import { hapticWarning } from '@/src/utils/haptics';
import type { PersonalEntry } from '@/src/types/models';

/**
 * Callback ESTABLE (PO 2026-09-22, rendimiento en gama baja — mismo patrón
 * que `GroupRow`/`ContactRow`): antes era una arrow function inline en el
 * `.map()`, así que envolver `EntryRow` en `React.memo` no servía de nada.
 */
export function useRemoveEntry(): (entry: PersonalEntry) => void {
  const { t } = useTranslation();
  const removeEntry = usePersonalStore(s => s.removeEntry);

  return useCallback((entry: PersonalEntry) => {
    const motivo = reasonKey(entry);
    if (motivo) {
      hapticWarning();
      Alert.alert(t('personal.locked_title'), t(motivo));
      return;
    }
    hapticWarning();
    Alert.alert(
      t('personal.remove_title'),
      t('personal.remove_body', { desc: entry.description }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: () => removeEntry(entry.id) },
      ],
    );
  }, [t, removeEntry]);
}
