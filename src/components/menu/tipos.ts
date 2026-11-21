import type { Ionicons } from '@expo/vector-icons';

export type Rect = { x: number; y: number; width: number; height: number };

export type Posicion = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  lado: 'abajo' | 'arriba';
};

/** Una opción del menú. Va como dato: la regla de alto y la a11y viven en el menú. */
export type OpcionMenu<V> = {
  valor: V;
  label: string;
  sublabel?: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  avatar?: { userId: string; name: string };
  destructive?: boolean;
  testID?: string;
};
