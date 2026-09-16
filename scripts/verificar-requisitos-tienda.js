/**
 * Guard de requisitos mínimos de tienda: un build de producción no debería salir con
 * un ícono/splash roto, un campo obligatorio vacío o un permiso sin su descripción de uso.
 *
 * Mira solo app.json + filesystem. Sin red, sin dependencias nuevas.
 * Corre como paso del gate de calidad en .eas/workflows/build-produccion.yml.
 */
const fs = require('fs');
const path = require('path');

const CAMPOS_OBLIGATORIOS = [
  ['expo.name', (expo) => expo.name],
  ['expo.slug', (expo) => expo.slug],
  ['expo.version', (expo) => expo.version],
  ['expo.ios.bundleIdentifier', (expo) => expo.ios && expo.ios.bundleIdentifier],
  ['expo.android.package', (expo) => expo.android && expo.android.package],
];

const CAMPOS_DE_ASSET = [
  ['expo.icon', (expo) => expo.icon],
  [
    'expo.android.adaptiveIcon.foregroundImage',
    (expo) => expo.android && expo.android.adaptiveIcon && expo.android.adaptiveIcon.foregroundImage,
  ],
  [
    'expo.android.adaptiveIcon.backgroundImage',
    (expo) => expo.android && expo.android.adaptiveIcon && expo.android.adaptiveIcon.backgroundImage,
  ],
  [
    'expo.android.adaptiveIcon.monochromeImage',
    (expo) => expo.android && expo.android.adaptiveIcon && expo.android.adaptiveIcon.monochromeImage,
  ],
  ['expo.web.favicon', (expo) => expo.web && expo.web.favicon],
];

const PARES_PERMISO_DESCRIPCION = [
  {
    permiso: 'android.permission.CAMERA',
    nombre: 'CAMERA',
    obtenerDescripcion: (expo) =>
      (expo.ios && expo.ios.infoPlist && expo.ios.infoPlist.NSCameraUsageDescription) ||
      (configDePlugin(expo.plugins, 'expo-camera') || {}).cameraPermission,
  },
  {
    permiso: 'android.permission.READ_MEDIA_IMAGES',
    nombre: 'READ_MEDIA_IMAGES',
    obtenerDescripcion: (expo) =>
      (expo.ios && expo.ios.infoPlist && expo.ios.infoPlist.NSPhotoLibraryUsageDescription) ||
      (configDePlugin(expo.plugins, 'expo-image-picker') || {}).photosPermission,
  },
];

function configDePlugin(plugins, nombre) {
  if (!Array.isArray(plugins)) return undefined;
  const entrada = plugins.find((p) => Array.isArray(p) && p[0] === nombre);
  return entrada ? entrada[1] : undefined;
}

function rutasDeSplash(expo) {
  const config = configDePlugin(expo.plugins, 'expo-splash-screen');
  if (!config) return [];
  const rutas = [];
  if (config.image) rutas.push(['expo.plugins[expo-splash-screen].image', config.image]);
  if (config.dark && config.dark.image) {
    rutas.push(['expo.plugins[expo-splash-screen].dark.image', config.dark.image]);
  }
  return rutas;
}

function esVacio(valor) {
  return typeof valor !== 'string' || valor.trim() === '';
}

function verificarCampos(expo) {
  return CAMPOS_OBLIGATORIOS.filter(([, obtener]) => esVacio(obtener(expo))).map(
    ([nombre]) => `Campo obligatorio vacío o ausente: ${nombre}`
  );
}

function verificarAssets(expo, raiz, existeArchivo = fs.existsSync) {
  const rutas = [
    ...CAMPOS_DE_ASSET.map(([nombre, obtener]) => [nombre, obtener(expo)]),
    ...rutasDeSplash(expo),
  ];
  return rutas
    .filter(([, ruta]) => !esVacio(ruta))
    .filter(([, ruta]) => !existeArchivo(path.join(raiz, ruta)))
    .map(([nombre, ruta]) => `Asset referenciado no existe en disco: ${nombre} → ${ruta}`);
}

function verificarPermisos(expo) {
  const permisos = (expo.android && expo.android.permissions) || [];
  const problemas = [];
  for (const par of PARES_PERMISO_DESCRIPCION) {
    const declarado = permisos.includes(par.permiso);
    const tieneDescripcion = !esVacio(par.obtenerDescripcion(expo));
    if (declarado && !tieneDescripcion) {
      problemas.push(`Permiso ${par.nombre} declarado en Android sin descripción de uso en iOS`);
    }
    if (!declarado && tieneDescripcion) {
      problemas.push(`Descripción de uso de ${par.nombre} presente en iOS sin el permiso Android declarado`);
    }
  }
  return problemas;
}

function verificar(appJson, raiz, existeArchivo = fs.existsSync) {
  const expo = appJson.expo || {};
  return [
    ...verificarCampos(expo),
    ...verificarAssets(expo, raiz, existeArchivo),
    ...verificarPermisos(expo),
  ];
}

function main(raiz = path.join(__dirname, '..'), log = console.error) {
  const appJson = JSON.parse(fs.readFileSync(path.join(raiz, 'app.json'), 'utf8'));
  const problemas = verificar(appJson, raiz);
  if (problemas.length === 0) return 0;
  log(`Requisitos de tienda incompletos:\n- ${problemas.join('\n- ')}`);
  return 1;
}

module.exports = { verificar, verificarCampos, verificarAssets, verificarPermisos, main };

if (require.main === module) process.exitCode = main();
