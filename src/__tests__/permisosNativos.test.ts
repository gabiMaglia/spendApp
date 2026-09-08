import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Los permisos que la app pide en Android, y los que se niega a pedir.
 *
 * **El problema que esto guarda no se ve en `app.json`.** El manifest final no
 * es lo que ahí se declara: los config plugins agregan lo suyo. El de
 * `react-native-webrtc` metía **micrófono, Bluetooth, ajustes de audio y dibujar
 * sobre otras apps** porque la librería sirve también para videollamadas.
 * Medido el 2026-09-04 sobre el manifest generado: `app.json` declaraba 6
 * permisos y el manifest tenía **13**.
 *
 * **Desde T-083 ese plugin ya no está** (se sacó junto con WebRTC entero: era una
 * función a la que no se llegaba desde ninguna pantalla). Los cuatro bloqueados
 * de abajo ya no pelean contra nada.
 *
 * ⚠️ **Y aun así se quedan, que es una decisión y no un olvido.** Un
 * `blockedPermissions` que bloquea permisos que nadie pide **no cuesta nada**, y
 * es la única defensa contra el próximo plugin —o el próximo comando— que los
 * reintroduzca en silencio. No es hipotético: el 2026-09-07
 * `eas update:configure` **duplicó esta lista y le agregó micrófono, Bluetooth y
 * cámara sin que nadie se lo pidiera** (T-079). Sacarlos sería quitar la red
 * justo después de ver la caída.
 *
 * Por qué esos cuatro y no otros — el costo de pedirlos es real:
 *
 *  - **Micrófono** en una app de gastos es una bandera roja en la revisión de
 *    Play y hay que justificarlo en el formulario de datos.
 *  - **Bluetooth** contradice lo que dice la pantalla de privacidad, que ya
 *    tuvo que corregirse una vez por afirmar cosas que el código no hacía.
 *  - **Dibujar sobre otras apps** es de los permisos más mirados que hay.
 *
 * `blockedPermissions` los marca `tools:node="remove"` y el merger los saca del
 * APK. Si mañana la app suma llamadas de verdad, esto se revisa a conciencia y
 * se declara en la ficha de la tienda — no se destraba borrando el guard.
 */

const app = JSON.parse(
  readFileSync(resolve(__dirname, '../../app.json'), 'utf8'),
) as { expo: { android: { permissions: string[]; blockedPermissions?: string[] } } };

const BLOQUEADOS_OBLIGATORIOS = [
  'android.permission.RECORD_AUDIO',
  'android.permission.MODIFY_AUDIO_SETTINGS',
  'android.permission.BLUETOOTH',
  'android.permission.SYSTEM_ALERT_WINDOW',
];

describe('permisos nativos de Android', () => {
  it('bloquea los cuatro que meten los plugins y la app no usa', () => {
    const bloqueados = app.expo.android.blockedPermissions ?? [];
    for (const permiso of BLOQUEADOS_OBLIGATORIOS) {
      expect(bloqueados).toContain(permiso);
    }
  });

  it('y no los pide por otro lado: bloquear y pedir a la vez sería ambiguo', () => {
    for (const permiso of BLOQUEADOS_OBLIGATORIOS) {
      expect(app.expo.android.permissions).not.toContain(permiso);
    }
  });

  /**
   * El bloqueo de arriba es correcto **porque** la app no captura media. Si
   * alguien agrega una llamada de audio o video, este test se cae y obliga a
   * revisar el bloqueo en vez de dejar la app pidiendo un permiso que le
   * quitaron del manifest — que fallaría en runtime, en el aparato del usuario.
   */
  it('la app sigue sin capturar audio ni video por WebRTC', () => {
    const { execSync } = require('child_process') as typeof import('child_process');
    const raiz = resolve(__dirname, '../..');
    // `--exclude-dir=__tests__` no es un detalle: sin eso el guard se caza a sí
    // mismo por nombrar lo que busca. Ya pasó dos veces en este repo —el guard
    // de `@noble` y el del patrón de store—, y la lección de esas veces fue que
    // un guard que falla por su propio comentario enseña a borrar el comentario.
    const salida = execSync(
      `grep -rl "getUserMedia\\|getDisplayMedia" app src components hooks ` +
      `--include='*.ts' --include='*.tsx' --exclude-dir=__tests__ || true`,
      { cwd: raiz, encoding: 'utf8' },
    ).trim();
    expect(salida).toBe('');
  });

  it('cada permiso que SÍ se pide tiene un uso en el código', () => {
    // No se enumeran usos acá para no duplicar el barrido: lo que importa es
    // que la lista no crezca sola. Si hay que agregar uno, se agrega también
    // acá y se explica en el commit.
    expect(app.expo.android.permissions.sort()).toEqual([
      'android.permission.ACCESS_NETWORK_STATE',   // relay: saber si hay red
      'android.permission.CAMERA',                 // QR de contacto y foto del recibo
      'android.permission.INTERNET',               // relay
      'android.permission.READ_MEDIA_IMAGES',      // elegir foto de perfil / recibo
      'android.permission.RECEIVE_BOOT_COMPLETED', // notificaciones locales
    ]);
  });
});
