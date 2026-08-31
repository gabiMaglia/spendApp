/**
 * Medidas del avatar. **Sin dependencias nativas, a propósito.**
 *
 * Vive separado de `avatar.ts` porque `contactChannel` necesita validar el
 * tamaño y está en el camino del sync: importar desde ahí un módulo que carga
 * `expo-image-manipulator` arrastraba el módulo nativo a
 * `relayEngine → groupStore → todas las pantallas`, y en un dispositivo sin ese
 * binario **la app entera dejaba de arrancar**. Una función de aritmética no
 * puede tumbar el sync.
 */

/**
 * Tope duro. La tarjeta de contacto viaja en CADA sync: una foto de teléfono
 * son 2-5 MB y degradaría la sincronización de todos, no solo la propia.
 * A 96×96 con calidad 0.7 el resultado ronda los 4-6 KB.
 */
export const AVATAR_MAX_BYTES = 24_000;

/** Lado del cuadrado y calidad JPEG del avatar. */
export const AVATAR_LADO = 96;
export const AVATAR_CALIDAD = 0.7;

/** Bytes reales de una imagen en data URI (base64 infla ~4/3). */
export function avatarByteSize(dataUri: string): number {
  const base64 = dataUri.includes(',') ? dataUri.slice(dataUri.indexOf(',') + 1) : dataUri;
  const relleno = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - relleno);
}

export function avatarCabe(dataUri: string): boolean {
  return avatarByteSize(dataUri) <= AVATAR_MAX_BYTES;
}
