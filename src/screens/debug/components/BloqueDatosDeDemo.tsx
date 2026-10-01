import React from 'react';
import { Pressable, Text } from 'react-native';
import { router } from 'expo-router';

import { Typography } from '@/src/constants/typography';
import { useAuthStore } from '@/src/store/authStore';
import { cargarDatosDeDemo } from '@/src/screens/debug/datosDeDemo';
import { Block, estilosDiagnostico } from '@/src/screens/debug/components/Filas';

/** «DATOS DE DEMO» del Diagnóstico: el grupo y el mes de las capturas de tienda. */
export function BloqueDatosDeDemo({ c }: { c: any }) {
  const cargar = () => {
    const yoId = useAuthStore.getState().currentUser?.id;
    if (!yoId) return;
    cargarDatosDeDemo(yoId, Date.now());
    router.replace('/');
  };

  return (
    <Block title="DATOS DE DEMO" c={c}>
      <Text style={[Typography.bodyS, { color: c.textSecondary }]}>
        Agrega «Viaje a Bariloche» con Sofi y Martín, cinco gastos, un pago,
        presupuesto y movimientos del mes. Para las capturas de las tiendas.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={cargar}
        style={[estilosDiagnostico.card, { borderColor: c.semantic.positive, alignItems: 'center' }]}
      >
        <Text style={[Typography.bodyM, { color: c.semantic.positive, fontWeight: '700' }]}>
          Cargar datos de demo
        </Text>
      </Pressable>
    </Block>
  );
}
