import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

/**
 * Foto de perfil: se guarda como BYTES propios, no como URL del proveedor.
 *
 * Google entrega una URL de su CDN. Usarla tal cual sería más fácil, pero cada
 * peer bajaría la imagen de Google y eso le contaría a Google **quién mira a
 * quién y cuándo** — el mismo metadato por el que este proyecto descartó
 * Firebase. Además la URL caduca (el avatar se rompe solo más adelante) y no
 * se dibuja sin internet.
 *
 * Con bytes propios: funciona offline, no filtra nada y no caduca. El costo es
 * el tamaño, y por eso el redimensionado NO es opcional.
 */

/** 96 px alcanza para el círculo más grande de la app (56) en pantallas @2x/@3x. */
const LADO = 96;
const CALIDAD = 0.7;

/**
 * Tope duro. La tarjeta de contacto viaja en CADA sync: una foto de teléfono
 * son 2-5 MB y degradaría la sincronización de todos, no solo la propia.
 * A 96×96 con calidad 0.7 el resultado ronda los 4-6 KB.
 */
export const AVATAR_MAX_BYTES = 24_000;

/** Bytes reales de una imagen en data URI (base64 infla ~4/3). */
export function avatarByteSize(dataUri: string): number {
  const base64 = dataUri.includes(',') ? dataUri.slice(dataUri.indexOf(',') + 1) : dataUri;
  const relleno = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - relleno);
}

export function avatarCabe(dataUri: string): boolean {
  return avatarByteSize(dataUri) <= AVATAR_MAX_BYTES;
}

/**
 * Achica cualquier imagen al cuadrado del avatar y la devuelve como data URI.
 * `null` si no se pudo — nunca se devuelve la original sin achicar, que es
 * justamente lo que no puede viajar.
 */
export async function achicarAAvatar(uri: string): Promise<string | null> {
  try {
    const r = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: LADO, height: LADO } }],
      { compress: CALIDAD, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    if (!r.base64) return null;
    const dataUri = `data:image/jpeg;base64,${r.base64}`;
    // Si aun achicada no entra, es preferible quedarse sin foto que arrastrar
    // un peso desconocido en cada sobre.
    return avatarCabe(dataUri) ? dataUri : null;
  } catch {
    return null; // sin foto se sigue con las iniciales; nunca se rompe nada
  }
}

/**
 * Abre la galería y devuelve la foto ya achicada. `null` si el usuario
 * canceló o si no se pudo procesar.
 *
 * Sin pantalla de recorte ni confirmación (decisión del PO): se elige y se
 * guarda, igual que cambiar el nombre.
 */
export async function elegirAvatarDeGaleria(): Promise<string | null> {
  const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permiso.granted) return null;

  const r = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 1,          // la compresión real la hace `achicarAAvatar`
  });
  if (r.canceled || !r.assets?.[0]) return null;
  return achicarAAvatar(r.assets[0].uri);
}

/**
 * Trae la foto del proveedor UNA vez y la convierte en bytes propios. A partir
 * de acá la imagen deja de depender de Google.
 */
export async function adoptarAvatarDelProveedor(url: string | undefined): Promise<string | null> {
  if (!url) return null;
  return achicarAAvatar(url);
}
