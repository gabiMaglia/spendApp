/**
 * Doble de `useRectAncla` para tests de pantalla: en Jest `measureInWindow` no
 * responde y el abanico se quedaría sin posición. La geometría real se prueba
 * en `src/components/menu/__tests__`.
 */
export const rectAnclaFalso = {
  useRectAncla: () => ({ x: 36, y: 200, width: 60, height: 60 }),
};
