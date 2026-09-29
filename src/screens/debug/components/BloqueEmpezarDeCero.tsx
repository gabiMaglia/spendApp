import React from 'react';
import { Alert, Pressable, Text } from 'react-native';
import { router } from 'expo-router';

import { Typography } from '@/src/constants/typography';
import { wipeAllAccounts } from '@/src/store/wipeDevice';
import { Block, estilosDiagnostico } from '@/src/screens/debug/components/Filas';

/** «EMPEZAR DE CERO» del Diagnóstico. T-223: salió de `app/debug/identity.tsx`. */
export function BloqueEmpezarDeCero({ c }: { c: any }) {
  return (
    <Block title="EMPEZAR DE CERO" c={c}>
      <Text style={[Typography.bodyS, { color: c.textSecondary }]}>
        Borra todas las cuentas de este teléfono y sus datos, para poder
        probar el primer login sin desinstalar la app. El tema y el idioma
        no se tocan.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          Alert.alert(
            'Borrar todas las cuentas',
            'Se borran las cuentas de este dispositivo y TODOS sus gastos, grupos y pagos. No se puede deshacer.',
            [
              { text: 'Cancelar', style: 'cancel' },
              {
                text: 'Borrar todo',
                style: 'destructive',
                onPress: () => {
                  wipeAllAccounts();
                  router.replace('/auth');
                },
              },
            ],
          );
        }}
        style={[estilosDiagnostico.card, { borderColor: c.semantic.negative, alignItems: 'center' }]}
      >
        <Text style={[Typography.bodyM, { color: c.semantic.negative, fontWeight: '700' }]}>
          Borrar todas las cuentas y datos
        </Text>
      </Pressable>
    </Block>
  );
}
