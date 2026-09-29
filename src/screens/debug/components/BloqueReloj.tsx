import React from 'react';
import { Text } from 'react-native';

import { Typography } from '@/src/constants/typography';
import { clockOffsetMs, hasClockReference, clockIsOff } from '@/src/utils/syncedClock';
import { Aviso, Block, Row } from '@/src/screens/debug/components/Filas';

/**
 * «RELOJ (ADR-005)» del Diagnóstico y su aviso. T-223: salió de
 * `app/debug/identity.tsx`. Fragmento a propósito: bloque y aviso son hijos
 * directos del ScrollView (con `gap`), como antes.
 */
export function BloqueReloj({ c }: { c: any }) {
  return (
    <>
      <Block title="RELOJ (ADR-005)" c={c}>
        <Row
          label="referencia del relay"
          value={hasClockReference() ? 'sí' : 'todavía no'}
          c={c}
          warn={!hasClockReference()}
        />
        <Row
          label="desfase de este teléfono"
          value={`${Math.round(clockOffsetMs() / 1000)} s`}
          c={c}
          warn={clockIsOff()}
        />
      </Block>

      {/* Corregir `updatedAt` arregla el merge, pero NO lo que el usuario VE:
          las fechas de los gastos siguen saliendo del reloj del teléfono. */}
      {clockIsOff() && (
        <Aviso color={c.semantic.warning} titulo="La hora de este teléfono está mal">
          <Text style={[Typography.bodyS, { color: c.textSecondary }]}>
            El sync ya se corrige solo, pero las FECHAS de los gastos que cargues
            van a salir con la hora equivocada. Conviene arreglarla en los ajustes
            del sistema.
          </Text>
        </Aviso>
      )}
    </>
  );
}
