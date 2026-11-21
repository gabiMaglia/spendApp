import React from 'react';
import type { View } from 'react-native';

import { BottomSheet, SheetOption, SheetOptionAvatar } from '@/src/components/Sheet';
import { MenuAnclado } from '@/src/components/menu/MenuAnclado';
import type { OpcionMenu } from '@/src/components/menu/tipos';
import { useSkinTokens } from '@/src/skins/useSkin';

/**
 * Selector de una opción entre varias: en Aero, menú pegado al disparador; en
 * Clásico, la hoja de siempre. La bifurcación vive acá para que los
 * consumidores no repitan el `if` de skin (T-282). `MenuAnclado` no sabe de skins.
 */
export function SelectorAdaptativo<V>({
  visible, onClose, ancla, opciones, seleccionado, onElegir, titulo, accessibilityLabel, testID,
}: {
  visible: boolean;
  onClose: () => void;
  ancla: React.RefObject<View | null>;
  opciones: OpcionMenu<V>[];
  seleccionado?: V;
  onElegir: (v: V) => void;
  /** Sólo lo usa la hoja (Clásico). */
  titulo: string;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const soft = useSkinTokens().flags.soft;

  if (soft) {
    return (
      <MenuAnclado
        visible={visible} onClose={onClose} ancla={ancla} opciones={opciones}
        seleccionado={seleccionado} onElegir={onElegir}
        accessibilityLabel={accessibilityLabel ?? titulo} testID={testID}
      />
    );
  }

  const elegir = (v: V) => { onElegir(v); onClose(); };
  return (
    <BottomSheet visible={visible} onClose={onClose} title={titulo}>
      {opciones.map((o, i) => {
        const last = i === opciones.length - 1;
        const sel = o.valor === seleccionado;
        return o.avatar ? (
          <SheetOptionAvatar
            key={String(o.valor)} userId={o.avatar.userId} name={o.avatar.name} hint={o.sublabel}
            selected={sel} onPress={() => elegir(o.valor)} last={last}
          />
        ) : (
          <SheetOption
            key={String(o.valor)} icon={o.icon} label={o.label} sublabel={o.sublabel} selected={sel}
            destructive={o.destructive} onPress={() => elegir(o.valor)} last={last} testID={o.testID}
          />
        );
      })}
    </BottomSheet>
  );
}
