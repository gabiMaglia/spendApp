import * as ImagePicker from 'expo-image-picker';
import { AVATAR_CALIDAD, AVATAR_LADO, avatarCabe } from './avatarSize';

export { AVATAR_MAX_BYTES, avatarByteSize, avatarCabe } from './avatarSize';

/**
 * El manipulador se carga PEREZOSAMENTE.
 *
 * Es un módulo nativo: en un dispositivo cuyo build no lo incluye todavía,
 * importarlo arriba de todo tumba el archivo entero — y con él, cualquiera que
 * lo importe. Cargarlo recién al usarlo hace que la app siga funcionando sin
 * foto de perfil en vez de no arrancar.
 */
function cargarManipulador(): typeof import('expo-image-manipulator') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-image-manipulator');
  } catch {
    return null;
  }
}

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

/**
 * Achica cualquier imagen al cuadrado del avatar y la devuelve como data URI.
 * `null` si no se pudo — nunca se devuelve la original sin achicar, que es
 * justamente lo que no puede viajar.
 */
export async function achicarAAvatar(uri: string): Promise<string | null> {
  try {
    const manip = cargarManipulador();
    if (!manip) return null;   // build sin el módulo: se sigue con iniciales
    const r = await manip.manipulateAsync(
      uri,
      [{ resize: { width: AVATAR_LADO, height: AVATAR_LADO } }],
      { compress: AVATAR_CALIDAD, format: manip.SaveFormat.JPEG, base64: true },
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
