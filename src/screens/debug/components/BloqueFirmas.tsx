import React from 'react';
import { Text } from 'react-native';

import { Typography } from '@/src/constants/typography';
import { useLiveValue } from '@/src/hooks/useLiveValue';
import {
  recordStats, verifyCost, unverifiableBreakdown, invalidRecords, benchmarkVerify, omittedCount,
} from '@/src/sync/confianza/recordHealth';
import { signingAuthors } from '@/src/sync/confianza/ratchet';
import { Block, Row } from '@/src/screens/debug/components/Filas';

/**
 * T-041 · S6 — firmas POR REGISTRO, en modo MARCA.
 * Nada de esto rechaza nada: todo lo contado acá entró y sumó al balance.
 * Los cuatro juntos o ninguno: `no_verificable` en 0 significa cosas
 * opuestas segun `valida` sea 0 o no. T-223: salió de `app/debug/identity.tsx`.
 */
export function BloqueFirmas({ c }: { c: any }) {
  const firmas    = useLiveValue(recordStats);
  const omitidos  = useLiveValue(omittedCount);
  const costo     = useLiveValue(verifyCost);
  const sinFirma  = useLiveValue(unverifiableBreakdown);
  const invalidos = useLiveValue(invalidRecords);
  const firmantes = useLiveValue(signingAuthors);

  /**
   * Cuánto tarda UNA verificación en ESTE teléfono. Es el gate S6→S7: el plan
   * midió 3,9 ms/op en una laptop Intel y se negó, bien, a inventar el
   * multiplicador de Hermes. Corre diferido para no trabar el primer render, y
   * existe porque `costo` no dice nada hasta que haya tráfico firmado real.
   */
  const [bench, setBench] = React.useState<number | null>(null);
  React.useEffect(() => {
    const id = setTimeout(() => setBench(benchmarkVerify(20)), 0);
    return () => clearTimeout(id);
  }, []);

  return (
    <Block title="FIRMAS DE REGISTRO (T-041)" c={c}>
      <Row label="verificadas" value={String(firmas.valida)} c={c}
           warn={firmas.valida === 0 && firmas.no_verificable > 0} />
      <Row label="no se pudo verificar" value={String(firmas.no_verificable)} c={c} />
      <Row label="…de autores que nunca firman" value={String(sinFirma.desconocido)} c={c} />
      <Row label="…de autores que sí firman" value={String(sinFirma.firma)} c={c}
           warn={sinFirma.firma > 0} />
      {/* La señal. El criterio de cierre de la fase de rechazo es este
          numero sostenido en 0 con "verificadas" > 0. */}
      <Row label="firma que NO cierra" value={String(firmas.invalida)} c={c}
           warn={firmas.invalida > 0} />
      {/* Cuarta categoria (D4): nadie puede firmarlos por diseño. No se
          mezclan con los de arriba y su piso NO cuenta para el cierre. */}
      <Row label="no firmables por diseño" value={String(firmas.no_firmable)} c={c} />
      <Row label="autores a los que vimos firmar" value={String(firmantes.length)} c={c} />
      {/* Sin esta fila, los cuatro contadores en cero significan DOS cosas
          opuestas: que no llegó ningún sobre, o que llegó y ya lo teníamos
          todo. Con `omitidos` en 0 y todo lo demás en 0, el sync no está
          trayendo nada. */}
      <Row label="ya los tenía (no se recuentan)" value={String(omitidos)} c={c}
           warn={omitidos === 0 && firmas.valida === 0 && firmas.no_verificable === 0} />
      {invalidos.map(o => (
        <Text key={`${o.groupId}${o.authorId}`} style={[Typography.bodyS, { color: c.textSecondary }]}>
          {o.authorId.slice(0, 8)}… en {o.groupId.slice(0, 8)}… ×{o.count}
        </Text>
      ))}
      {/* El gate S6→S7: cuanto cuesta verificar en Hermes, en ESTE aparato. */}
      <Row
        label="costo real medido"
        value={costo.msPorOp === null
          ? `— (todavía ninguna, ${costo.ops} ops)`
          : `${costo.msPorOp.toFixed(2)} ms/op · ${costo.ops} ops`}
        c={c}
      />
      <Row
        label="banco de pruebas de este teléfono"
        value={bench === null ? 'midiendo…' : `${bench.toFixed(2)} ms/op`}
        c={c}
        warn={bench !== null && bench > 20}
      />
    </Block>
  );
}
