import React, { useState } from 'react';
import { Pressable, Text } from 'react-native';

import { Typography } from '@/src/constants/typography';
import { programarResumenDePrueba } from '@/src/screens/debug/notificacionDePrueba';
import { Block, estilosDiagnostico } from '@/src/screens/debug/components/Filas';

const SEGUNDOS = 10;

/** «NOTIFICACIÓN DE PRUEBA» del Diagnóstico: el resumen sin necesitar otro teléfono. */
export function BloqueNotificacionDePrueba({ c }: { c: any }) {
  const [estado, setEstado] = useState('');

  const probar = async () => {
    const ok = await programarResumenDePrueba(SEGUNDOS);
    setEstado(ok ? `Programada: llega en ${SEGUNDOS} s. Salí o cerrá la app.` : 'No se pudo: falta el permiso o el módulo nativo.');
  };

  return (
    <Block title="NOTIFICACIÓN DE PRUEBA" c={c}>
      <Text style={[Typography.bodyS, { color: c.textSecondary }]}>
        Programa el resumen de avisos a {SEGUNDOS} segundos. Tocarlo tiene que abrir
        Actividad una sola vez, con la app en segundo plano o cerrada.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={probar}
        style={[estilosDiagnostico.card, { borderColor: c.semantic.positive, alignItems: 'center' }]}
      >
        <Text style={[Typography.bodyM, { color: c.semantic.positive, fontWeight: '700' }]}>
          Probar notificación de resumen
        </Text>
      </Pressable>
      {estado ? <Text testID="noti-prueba-estado" style={[Typography.bodyS, { color: c.textSecondary }]}>{estado}</Text> : null}
    </Block>
  );
}
