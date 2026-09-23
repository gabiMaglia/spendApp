import React from 'react';
import { useTranslation } from 'react-i18next';

import { Segmented } from '@/src/components/Band';
import { hapticSelection } from '@/src/utils/haptics';
import { PERSONAL_ACTIVITY_KEY } from '@/src/store/selectors';
import { ALL_FILTER } from '@/src/screens/activity/hooks/useActivityFilter';

/** Pestañas comunes de la app («T invertida»), no chips con relleno: un chip lleno en verde
 * de marca compite con los montos del feed, que es lo que hay que leer. */
export function ActivityFilterTabs({
  allGroupNames, value, onChange,
}: { allGroupNames: string[]; value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  return (
    <Segmented
      variant="tabs"
      scroll
      borde="ambos"
      value={value}
      onChange={f => { hapticSelection(); onChange(f); }}
      options={allGroupNames.map(f => ({
        key: f,
        label: f === ALL_FILTER ? t('activity.filter_all')
          : f === PERSONAL_ACTIVITY_KEY ? t('activity.filter_personal')
          : f,
        icon: f === ALL_FILTER ? 'apps-outline'
          : f === PERSONAL_ACTIVITY_KEY ? 'person-outline'
          : 'people-outline',
      }))}
    />
  );
}
