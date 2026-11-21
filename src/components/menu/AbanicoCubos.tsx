import React, { useEffect, useState } from 'react';
import { Modal, useWindowDimensions, type View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ColumnaAbanico } from '@/src/components/menu/ColumnaAbanico';
import { VeloMenu } from '@/src/components/menu/VeloMenu';
import { calcularAbanico } from '@/src/components/menu/calcularAbanico';
import { useAnimacionMenu } from '@/src/components/menu/useAnimacionMenu';
import { useEleccionUnica } from '@/src/components/menu/useEleccionUnica';
import { useRectAncla } from '@/src/components/menu/useRectAncla';
import type { OpcionCubo } from '@/src/components/menu/tipos';

/** Lo que tarda la entrada en asentar: hasta entonces los cubos no reciben toques. */
export const ASENTAR_MS = 260;

export type AbanicoCubosProps<V> = {
  visible: boolean;
  onClose: () => void;
  /** El cubo original: el primer cubo del abanico cae exactamente sobre su rect. */
  ancla: React.RefObject<View | null>;
  opciones: OpcionCubo<V>[];
  seleccionado?: V;
  onElegir: (v: V) => void;
  accessibilityLabel: string;
  /** Etiqueta (ya traducida) del velo, que para el lector de pantalla es el botón «cerrar». */
  etiquetaCerrar: string;
  testID?: string;
};

/**
 * Columna de cubos que sale del cubo de la tarjeta (T-283). Sin recuadro: cubos
 * flotando sobre el velo. Comparte con `MenuAnclado` el velo, el guard de
 * elección, la medición del ancla y el desmontaje, no la forma.
 */
export function AbanicoCubos<V>({
  visible, onClose, ancla, opciones, seleccionado, onElegir, accessibilityLabel, etiquetaCerrar, testID,
}: AbanicoCubosProps<V>) {
  const ventana = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const rect = useRectAncla({ visible, ancla, onCerrar: onClose });
  const geo = rect ? calcularAbanico(rect, ventana, insets, opciones.length) : null;

  const { montado, sinAnimacion, estiloVelo } = useAnimacionMenu({ visible, listo: !!geo, lado: undefined });
  // Durante la apertura el cubo 0 está invisible justo sobre el ancla: un segundo toque
  // del doble toque no puede elegirlo. Se toca recién con la entrada asentada.
  const [asentado, setAsentado] = useState(false);
  useEffect(() => {
    if (!visible || !geo) { setAsentado(false); return; }
    const id = setTimeout(() => setAsentado(true), ASENTAR_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, !!geo]);
  // Cuenta de aperturas: la columna lleva esto de `key` y no reusa nada de la anterior.
  const [{ prev, apertura }, setAp] = useState({ prev: visible, apertura: 0 });
  if (visible !== prev) setAp({ prev: visible, apertura: visible ? apertura + 1 : apertura });
  const tocable = visible && !!geo && asentado;
  const elegir = useEleccionUnica<V>({ visible, tocable, onElegir, onClose });

  if (!montado) return null;

  return (
    <Modal
      transparent animationType="none" onRequestClose={onClose}
      statusBarTranslucent navigationBarTranslucent
    >
      <VeloMenu
        visible={visible} estilo={estiloVelo} onClose={onClose} etiquetaCerrar={etiquetaCerrar}
        testID={testID ? `${testID}-velo` : undefined}
      />
      {geo && (
        <ColumnaAbanico
          key={apertura} geo={geo} opciones={opciones} seleccionado={seleccionado}
          visible={visible} sinAnimacion={sinAnimacion} tocable={tocable}
          onElegir={elegir} onClose={onClose} accessibilityLabel={accessibilityLabel} testID={testID}
        />
      )}
    </Modal>
  );
}
