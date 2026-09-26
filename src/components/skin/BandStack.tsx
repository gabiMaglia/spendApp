import React from 'react';
import { View } from 'react-native';
import { useSkinTokens } from '@/src/skins/useSkin';
import { Panel } from './Panel';

type Contenedor = React.ComponentType<{ children: React.ReactNode }>;

/**
 * **Bandas que van pegadas** (idea del PO, etapa 2 del Aero).
 *
 * Con el Clásico devuelve los hijos tal cual: las bandas ya se unen por sus
 * hairlines (`noTop`). Con un skin `soft`:
 *  - `modo="unido"` (default): un solo contenedor con todas adentro, separadas
 *    por un divisor suave → se leen como una tarjeta;
 *  - `modo="separado"`: un contenedor por hijo → tarjetas sueltas con aire.
 *
 * `Contenedor` (default `Panel`) permite cambiar el envoltorio sin tocar esto.
 */
export function BandStack({
  children, modo = 'unido', Contenedor = Panel,
}: {
  children: React.ReactNode;
  modo?: 'unido' | 'separado';
  Contenedor?: Contenedor;
}) {
  const skin = useSkinTokens();
  if (!skin.flags.soft) return <>{children}</>;

  const hijos = React.Children.toArray(children).filter(Boolean);
  if (modo === 'separado') {
    return <>{hijos.map((h, i) => <Contenedor key={i}>{h}</Contenedor>)}</>;
  }
  return (
    <Contenedor>
      {hijos.map((h, i) => (
        <React.Fragment key={i}>
          {i > 0 && (
            <View
              testID="band-stack-divisor"
              style={{ height: 1, marginHorizontal: skin.space.inset, backgroundColor: skin.colors.edgeShade }}
            />
          )}
          {h}
        </React.Fragment>
      ))}
    </Contenedor>
  );
}
