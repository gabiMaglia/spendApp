import { createContext } from 'react';

/**
 * Presente cuando una `Band` está DENTRO de un `Panel` del skin: el panel ya
 * pone fondo, radio y sombra, así que la banda saca sus hairlines y su fondo
 * (salvo `sunken`, que toma `sunkenBg` del skin). `null` = fuera de un panel.
 */
export const PanelContext = createContext<null | { sunkenBg: string }>(null);
