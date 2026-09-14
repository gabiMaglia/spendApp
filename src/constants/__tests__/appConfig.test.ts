import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Metadatos iOS para App Review (T-123).
 *
 * Guarda contra tres cosas que el audit `qa/AUDIT2-appstore-2026-09-13.md`
 * encontró rotas: un permiso pedido sin uso real (Face ID, T-092 en pausa),
 * usage strings que sólo existen en español pese a que la app es es/en/pt, y
 * un texto que promete una función (escanear el TEXTO de un ticket) que no
 * existe — la cámara saca una foto, no hace OCR.
 */

const ROOT = resolve(__dirname, '../../..');
const app = JSON.parse(readFileSync(resolve(ROOT, 'app.json'), 'utf8')) as {
  expo: {
    locales?: Record<string, string>;
    ios: {
      infoPlist?: Record<string, unknown>;
      privacyManifests?: {
        NSPrivacyCollectedDataTypes?: {
          NSPrivacyCollectedDataType: string;
          NSPrivacyCollectedDataTypeLinked: boolean;
          NSPrivacyCollectedDataTypeTracking: boolean;
          NSPrivacyCollectedDataTypePurposes: string[];
        }[];
      };
    };
    plugins: (string | [string, Record<string, unknown>])[];
  };
};

function pluginConfig(name: string): Record<string, unknown> | undefined {
  const entry = app.expo.plugins.find((p) => Array.isArray(p) && p[0] === name);
  return Array.isArray(entry) ? entry[1] : undefined;
}

describe('app.json — metadatos iOS (T-123)', () => {
  it('no pide Face ID: T-092 está en pausa y no hay código que lo use', () => {
    expect(app.expo.ios.infoPlist?.NSFaceIDUsageDescription).toBeUndefined();
  });

  it('declara expo.locales con es/en/pt y las mismas claves en cada uno', () => {
    expect(app.expo.locales).toBeDefined();
    const locales = app.expo.locales as Record<string, string>;
    for (const code of ['es', 'en', 'pt']) {
      expect(locales[code]).toBeDefined();
    }

    const claves = Object.keys(locales).map((code) => {
      const ruta = resolve(ROOT, locales[code]);
      expect(existsSync(ruta)).toBe(true);
      return Object.keys(JSON.parse(readFileSync(ruta, 'utf8'))).sort();
    });
    // Todas las traducciones cubren exactamente el mismo set de claves que la
    // primera (es, fuente de verdad) — si a una le falta una clave, Apple le
    // muestra al usuario ese permiso en el idioma que sí la tenga (fallback).
    for (const set of claves) {
      expect(set).toEqual(claves[0]);
    }
  });

  it('el string de cámara no promete OCR/lectura de texto — sólo foto y QR, que es lo que hace', () => {
    const camara = pluginConfig('expo-camera')?.cameraPermission as string;
    expect(camara).toBeTruthy();
    expect(camara.toLowerCase()).not.toMatch(/ocr|leer el texto|reconocer el texto/);
    expect(camara.toLowerCase()).toMatch(/qr/);
  });

  it('el string de fotos habla del avatar de perfil, no de "ticket" (no es su uso real)', () => {
    const fotos = pluginConfig('expo-image-picker')?.photosPermission as string;
    expect(fotos).toBeTruthy();
    expect(fotos.toLowerCase()).toMatch(/perfil/);
    expect(fotos.toLowerCase()).not.toMatch(/ticket/);
  });

  it('privacyManifests declara email y user id de login, vinculados, sin tracking, App Functionality', () => {
    const tipos = app.expo.ios.privacyManifests?.NSPrivacyCollectedDataTypes ?? [];
    for (const clave of ['NSPrivacyCollectedDataTypeEmailAddress', 'NSPrivacyCollectedDataTypeUserID']) {
      const entrada = tipos.find((t) => t.NSPrivacyCollectedDataType === clave);
      expect(entrada).toBeDefined();
      expect(entrada?.NSPrivacyCollectedDataTypeLinked).toBe(true);
      expect(entrada?.NSPrivacyCollectedDataTypeTracking).toBe(false);
      expect(entrada?.NSPrivacyCollectedDataTypePurposes).toEqual(['NSPrivacyCollectedDataTypePurposeAppFunctionality']);
    }
  });

  it('no toca ITSAppUsesNonExemptEncryption (espera firma del PO, ADR-010)', () => {
    expect(app.expo.ios.infoPlist?.ITSAppUsesNonExemptEncryption).toBe(false);
  });
});
