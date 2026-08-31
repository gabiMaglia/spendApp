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
let manipCache: typeof import('expo-image-manipulator') | null | undefined;

function cargarManipulador(): typeof import('expo-image-manipulator') | null {
  // Memoizado: en un build sin el módulo, cada intento imprime un error rojo
  // en dev. Preguntar dos veces por la misma foto lo imprimía dos veces y
  // hacía parecer que había dos fallas distintas.
  if (manipCache !== undefined) return manipCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    manipCache = require('expo-image-manipulator');
  } catch {
    manipCache = null;
  }
  return manipCache ?? null;
}

/** Solo para tests: el módulo se resuelve una vez por proceso. */
export function __resetManipulador(): void {
  manipCache = undefined;
}

/**
 * ¿El build de este dispositivo trae el módulo nativo?
 *
 * Existe para poder DISTINGUIR "tu app está vieja" de "esa imagen no se pudo
 * procesar". Sin esta distinción el usuario recibe siempre el mismo mensaje y
 * se va a probar con otra foto, que nunca va a andar.
 */
export function manipuladorDisponible(): boolean {
  return cargarManipulador() !== null;
}

/** Por qué no salió la foto. `cancelado` NO es un error: el usuario decidió. */
export type FalloAvatar = 'cancelado' | 'sin_permiso' | 'sin_modulo' | 'no_procesable';

export type ResultadoAvatar =
  | { ok: true; dataUri: string }
  | { ok: false; motivo: FalloAvatar };

/**
 * Clave i18n del mensaje para cada fallo, o `null` si no hay nada que decir.
 *
 * Es un `switch` exhaustivo a propósito: agregar un motivo sin decidir qué se
 * le muestra al usuario rompe la compilación en vez de fallar en silencio, que
 * es exactamente el defecto que este cambio vino a corregir.
 */
export function claveDeFallo(motivo: FalloAvatar): string | null {
  switch (motivo) {
    case 'cancelado':     return null;
    case 'sin_permiso':   return 'profile.photo_error_permission';
    case 'sin_modulo':    return 'profile.photo_error_unavailable';
    case 'no_procesable': return 'profile.photo_error_failed';
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
export async function elegirAvatarDeGaleria(): Promise<ResultadoAvatar> {
  const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permiso.granted) return { ok: false, motivo: 'sin_permiso' };

  const r = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 1,          // la compresión real la hace `achicarAAvatar`
  });
  if (r.canceled || !r.assets?.[0]) return { ok: false, motivo: 'cancelado' };

  // Se pregunta ANTES de intentar: si el módulo nativo no está en el build, el
  // problema no es la imagen y mandar al usuario a probar con otra es mandarlo
  // a un callejón sin salida.
  if (!manipuladorDisponible()) return { ok: false, motivo: 'sin_modulo' };

  const foto = await achicarAAvatar(r.assets[0].uri);
  return foto ? { ok: true, dataUri: foto } : { ok: false, motivo: 'no_procesable' };
}

/**
 * Trae la foto del proveedor UNA vez y la convierte en bytes propios. A partir
 * de acá la imagen deja de depender de Google.
 */
export async function adoptarAvatarDelProveedor(url: string | undefined): Promise<string | null> {
  if (!url) return null;
  return achicarAAvatar(url);
}
