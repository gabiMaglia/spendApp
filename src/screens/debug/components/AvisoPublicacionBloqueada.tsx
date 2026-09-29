import React from 'react';
import { Text } from 'react-native';

import { Typography } from '@/src/constants/typography';
import { useLiveValue } from '@/src/hooks/useLiveValue';
import { useGroupStore } from '@/src/store/groupStore';
import { blockingFailures } from '@/src/sync/motor/publishHealth';
import { Aviso } from '@/src/screens/debug/components/Filas';

/**
 * Si publicar falla y nadie lo cuenta, el sintoma es "no me llega nada" sin
 * nada que mirar. Ya paso dos veces. T-223: salió de `app/debug/identity.tsx`.
 *
 * `blockingFailures` vive en una variable de módulo que el sync actualiza por
 * detrás: leerlo en el render lo dejaba congelado en el valor del montaje.
 */
export function AvisoPublicacionBloqueada({ c }: { c: any }) {
  const bloqueantes = useLiveValue(blockingFailures);
  if (bloqueantes.length === 0) return null;

  return (
    <Aviso color={c.semantic.negative} titulo={`${bloqueantes.length} grupo(s) que NO se están publicando`}>
      {bloqueantes.map(f => (
        <Text key={f.groupId} style={[Typography.bodyS, { color: c.textSecondary }]}>
          {useGroupStore.getState().getById(f.groupId)?.name ?? f.groupId}: {f.reason}
          {f.reason === 'too_large'
            ? ' — el sobre pasó los 256KB. Los cambios de este grupo dejaron de viajar.'
            : ' — falta la clave del grupo.'}
        </Text>
      ))}
    </Aviso>
  );
}
