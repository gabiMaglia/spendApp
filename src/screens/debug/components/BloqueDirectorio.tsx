import React from 'react';
import { Text } from 'react-native';

import { Typography } from '@/src/constants/typography';
import { useLiveValue } from '@/src/hooks/useLiveValue';
import { ensureIdentity } from '@/src/store/identityStore';
import { unverifiedAuthors, authorStats } from '@/src/sync/confianza/authorHealth';
import { useDirectorioDeClaves } from '@/src/screens/debug/hooks/useDirectorioDeClaves';
import { Block, Row } from '@/src/screens/debug/components/Filas';

/**
 * «DIRECTORIO DE CLAVES (ADR-004)» del Diagnóstico. T-223: salió de
 * `app/debug/identity.tsx`.
 *
 * Los contadores viven en variables de módulo que el sync actualiza por
 * detrás. Leerlos en el render dejaba la pantalla congelada en el valor del
 * montaje: el sync contaba bien y acá se veían ceros para siempre.
 */
export function BloqueDirectorio({ cuenta, c }: { cuenta: string | null; c: any }) {
  const { directorio, alta, misClaves } = useDirectorioDeClaves(cuenta);
  const sinVerificar = useLiveValue(unverifiedAuthors);
  const stats = useLiveValue(authorStats);

  return (
    <Block title="DIRECTORIO DE CLAVES (ADR-004)" c={c}>
      {/* Lectura del directorio, no intento de escritura. Ver `useDirectorioDeClaves`. */}
      <Row label="mi clave" value={directorio} c={c} warn={directorio === 'falta'} />
      {alta !== null && (
        <Row label="intento de alta" value={alta} c={c} warn={alta !== 'dada de alta recién'} />
      )}
      <Row label="dispositivos de esta cuenta" value={String(misClaves.length)} c={c}
           warn={misClaves.length === 0} />
      <Row label="esta es" value={`${ensureIdentity().publicKey.slice(0, 12)}…`} c={c} />
      {/*
        Fase B en modo AVISO: se cuenta lo que no verifica, no se descarta.
        Este número es el que decide si algún día se puede pasar a rechazo.
        Cero sostenido con gente real ⇒ el borde de Apple no pega en la
        práctica. Distinto de cero ⇒ rechazar romperia a alguien legítimo.
      */}
      {/*
        Los tres juntos o ninguno. "Sin verificar: 0" solo no dice nada:
        da cero tanto si todo verifico como si no se pudo consultar nada.
        Solo significa algo al lado de un "verificados" distinto de cero.
      */}
      <Row label="sobres verificados" value={String(stats.ok)} c={c}
           warn={stats.ok === 0 && stats.sin_directorio > 0} />
      <Row label="no se pudo consultar" value={String(stats.sin_directorio)} c={c}
           warn={stats.sin_directorio > 0} />
      <Row label="autores sin verificar" value={String(sinVerificar.length)} c={c}
           warn={sinVerificar.length > 0} />
      {sinVerificar.map(o => (
        <Text key={`${o.groupId}${o.senderKey}`} style={[Typography.bodyS, { color: c.textSecondary }]}>
          {o.accountId.slice(0, 8)}… firmó con {o.senderKey.slice(0, 8)}… ×{o.count}
        </Text>
      ))}
    </Block>
  );
}
