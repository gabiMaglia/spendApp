const path = require('path');
const {
  verificar,
  verificarCampos,
  verificarAssets,
  verificarPermisos,
} = require('../verificar-requisitos-tienda');

const RAIZ_REPO = path.join(__dirname, '..', '..');

function appJsonBase() {
  return {
    expo: {
      name: 'spendApp',
      slug: 'spendApp',
      version: '1.0.0',
      icon: './assets/images/icon.png',
      ios: {
        bundleIdentifier: 'com.splitp2p.app',
        infoPlist: {
          NSPhotoLibraryUsageDescription: 'Usamos tu galería de fotos.',
        },
      },
      android: {
        package: 'com.splitp2p.app',
        permissions: [
          'android.permission.CAMERA',
          'android.permission.READ_MEDIA_IMAGES',
        ],
        adaptiveIcon: {
          foregroundImage: './assets/images/android-icon-foreground.png',
          backgroundImage: './assets/images/android-icon-background.png',
          monochromeImage: './assets/images/android-icon-monochrome.png',
        },
      },
      web: { favicon: './assets/images/favicon.png' },
      plugins: [
        'expo-router',
        ['expo-splash-screen', { image: './assets/images/splash-nativo.png' }],
        ['expo-camera', { cameraPermission: 'Usamos la cámara para el ticket.' }],
        ['expo-image-picker', { photosPermission: 'Usamos tu galería.' }],
      ],
    },
  };
}

const existeSiempre = () => true;

describe('verificar (requisitos de tienda)', () => {
  it('no reporta problemas con un app.json completo y assets presentes', () => {
    const problemas = verificar(appJsonBase(), RAIZ_REPO, existeSiempre);
    expect(problemas).toEqual([]);
  });

  it('pasa contra el app.json real del repo (assets deben existir de verdad en disco)', () => {
    const appJsonReal = require(path.join(RAIZ_REPO, 'app.json'));
    const problemas = verificar(appJsonReal, RAIZ_REPO);
    expect(problemas).toEqual([]);
  });

  it('reporta un asset faltante', () => {
    const appJson = appJsonBase();
    // verificarAssets llama a existeArchivo con la ruta YA UNIDA a la raíz (path.join),
    // no con el valor crudo del campo — el predicado tiene que matchear sobre eso.
    const existeExcepto = (rutaAbsoluta) => !rutaAbsoluta.endsWith('/assets/images/icon.png');
    const problemas = verificarAssets(appJson.expo, RAIZ_REPO, existeExcepto);
    expect(problemas).toEqual([
      'Asset referenciado no existe en disco: expo.icon → ./assets/images/icon.png',
    ]);
  });

  it('reporta un campo obligatorio vacío', () => {
    const appJson = appJsonBase();
    appJson.expo.slug = '';
    const problemas = verificarCampos(appJson.expo);
    expect(problemas.some((p) => p.includes('expo.slug'))).toBe(true);
  });

  it('reporta un permiso Android sin su descripción de uso en iOS', () => {
    const appJson = appJsonBase();
    delete appJson.expo.ios.infoPlist.NSPhotoLibraryUsageDescription;
    appJson.expo.plugins = appJson.expo.plugins.filter(
      (p) => !(Array.isArray(p) && p[0] === 'expo-image-picker')
    );
    const problemas = verificarPermisos(appJson.expo);
    expect(problemas.some((p) => p.includes('READ_MEDIA_IMAGES'))).toBe(true);
  });

  it('reporta una descripción de uso huérfana sin el permiso Android declarado', () => {
    const appJson = appJsonBase();
    appJson.expo.android.permissions = ['android.permission.READ_MEDIA_IMAGES'];
    const problemas = verificarPermisos(appJson.expo);
    expect(problemas.some((p) => p.includes('CAMERA'))).toBe(true);
  });
});
