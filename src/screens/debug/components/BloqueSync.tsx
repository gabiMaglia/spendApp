import React from 'react';

import { useGroupStore } from '@/src/store/groupStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { isRelayConfigured } from '@/src/sync/adaptadores/supabase/relay';
import { ensureContactSecret, listPeers } from '@/src/sync/contactos/contactChannel';
import { Block, Row } from '@/src/screens/debug/components/Filas';

/**
 * «SYNC» del Diagnóstico. T-223: salió de `app/debug/identity.tsx`.
 *
 * Es lo que convierte un "no me llega nada" en un diagnóstico: sin relay
 * configurado, sin secreto propio o con contactos a los que les faltan las
 * públicas, la entrega de claves de grupo NO puede salir — y el síntoma es
 * siempre el mismo, no pasa nada y no hay error.
 *
 * `incompletos` viene de la pantalla porque también lo usa el aviso de
 * contactos a medias.
 */
export function BloqueSync({ incompletos, c }: { incompletos: number; c: any }) {
  const groups = useGroupStore(st => st.groups);
  const claves = useGroupKeyStore(st => st.keys);
  const peers = listPeers();
  const miSecreto = ensureContactSecret();

  const sinClave = groups.filter(g => !g.isDeleted && !claves.some(k => k.groupId === g.id));

  return (
    <Block title="SYNC" c={c}>
      <Row label="relay configurado" value={isRelayConfigured() ? 'sí' : 'NO'} c={c}
           warn={!isRelayConfigured()} />
      <Row label="mi buzón de contacto" value={miSecreto ? miSecreto.slice(0, 12) + '…' : 'NO'} c={c}
           warn={!miSecreto} />
      <Row label="contactos con buzón" value={String(Object.keys(peers).length)} c={c} />
      <Row label="…sin claves públicas" value={String(incompletos)} c={c} warn={incompletos > 0} />
      <Row label="grupos con clave" value={`${claves.length} de ${groups.filter(g => !g.isDeleted).length}`} c={c}
           warn={sinClave.length > 0} />
    </Block>
  );
}
