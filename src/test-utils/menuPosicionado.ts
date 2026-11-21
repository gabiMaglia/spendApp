/**
 * Doble de `usePosicionMenu` para tests de pantalla: en Jest `measureInWindow`
 * no responde y el menú se quedaría en el frame invisible (sin toques). La
 * geometría real se prueba en `src/components/menu/__tests__`.
 */
export const menuPosicionado = {
  usePosicionMenu: () => ({
    posicion: { left: 0, top: 0, width: 300, maxHeight: 300, lado: 'abajo' },
    maxHeight: undefined,
    onLayoutFila: () => {},
    anchoProvisional: 300,
    rect: { x: 0, y: 0, width: 300, height: 48 },
  }),
};
