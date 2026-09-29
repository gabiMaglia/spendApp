import React from 'react';
import { Switch, Text, View } from 'react-native';

import { Typography } from '@/src/constants/typography';
import { activo as renderLogActivo, setActivo as setRenderLogActivo } from '@/src/dev/contadorDeRenders';
import { Block, estilosDiagnostico } from '@/src/screens/debug/components/Filas';

/** «LOG DE RENDERS (DEV)» del Diagnóstico. T-223: salió de `app/debug/identity.tsx`. */
export function BloqueLogDeRenders({ c }: { c: any }) {
  // Log de re-renders (T-215): el flag vive en `contadorDeRenders.ts`, no acá
  // — este estado sólo espeja lo persistido para que el Switch pinte bien.
  const [logRenders, setLogRenders] = React.useState(renderLogActivo());

  return (
    <Block title="LOG DE RENDERS (DEV)" c={c}>
      <Text style={[Typography.bodyS, { color: c.textSecondary }]}>
        Imprime en consola, cada 2 s, cuántas veces se re-renderizó cada
        pantalla/componente instrumentado y qué cambió. No hace nada en
        producción — sólo sirve para chequear a mano en este teléfono.
      </Text>
      <View style={estilosDiagnostico.row}>
        <Text style={[Typography.bodyM, { color: c.text }]}>Log de renders (dev)</Text>
        <Switch
          value={logRenders}
          onValueChange={(v) => {
            setRenderLogActivo(v);
            setLogRenders(v);
            if (v) console.info('[renders] activo — resumen cada 2 s');
          }}
        />
      </View>
    </Block>
  );
}
