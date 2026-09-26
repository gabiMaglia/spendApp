import { createContext } from 'react';
import type { SkinColors } from '@/src/skins/types';

/**
 * Presente cuando una `Band` está DENTRO de un `Panel` del skin: el panel ya
 * pone fondo, radio y sombra, así que la banda saca sus hairlines y su fondo
 * (salvo `sunken`, que toma `sunkenBg` del skin). `colors` es la paleta del
 * skin: `useC()` la devuelve adentro del panel, así etiquetas y divisores de
 * las primitivas de `Band` usan los tokens del skin. `null` = fuera de un
 * panel (y `useC()` sigue siendo `Colors[scheme]`).
 */
export const PanelContext = createContext<null | { sunkenBg: string; colors: SkinColors }>(null);
