import React from 'react';
import { Text, View } from 'react-native';

import { Typography } from '@/src/constants/typography';
import type { useAuthStore } from '@/src/store/authStore';
import { Block, Row, estilosDiagnostico } from '@/src/screens/debug/components/Filas';

export type SnapshotIdentidad = ReturnType<ReturnType<typeof useAuthStore.getState>['identitySnapshot']>;

/** «CUENTAS CONOCIDAS EN ESTE DEVICE» del Diagnóstico. T-223: salió de `app/debug/identity.tsx`. */
export function BloqueCuentasConocidas({ snapshot, c }: { snapshot: SnapshotIdentidad; c: any }) {
  return (
    <Block title={`CUENTAS CONOCIDAS EN ESTE DEVICE (${snapshot.known.length})`} c={c}>
      {snapshot.known.length === 0 ? (
        <Text style={[Typography.bodyS, { color: c.textTertiary }]}>
          El índice está vacío. Si ya entraste con algún proveedor después de
          actualizar, esto no debería estar vacío: significa que la app está
          corriendo código viejo (recargá con una sacudida → Reload).
        </Text>
      ) : (
        snapshot.known.map(a => {
          const perfil = snapshot.profiles.find(p => p.accountId === a.accountId);
          return (
            <View key={a.accountId} style={[estilosDiagnostico.card, { borderColor: c.borderHair }]}>
              <Row label="accountId" value={a.accountId} c={c} />
              <Row label="nombre" value={perfil?.name ?? '—'} c={c} />
              <Row
                label="mail conocido"
                value={a.email ?? '(NUNCA lo supimos)'}
                c={c}
                warn={a.email === undefined}
              />
              {a.accountId === snapshot.activeAccountId && (
                <Text style={[Typography.bodyS, { color: c.semantic.positive }]}>← activa</Text>
              )}
            </View>
          );
        })
      )}
    </Block>
  );
}
