import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Variantes de la app (T-280). El build `development` lleva otro identificador para
 * instalarse AL LADO de la productiva: con el mismo, iOS lo trataba como la misma app y
 * reemplazaba la de la App Store junto con los datos locales del dueño del teléfono.
 * Doc: https://docs.expo.dev/build-reference/variants/
 */
type ConfigBase = {
  name: string;
  scheme?: string | string[];
  ios?: { bundleIdentifier?: string; associatedDomains?: string[]; [k: string]: unknown };
  android?: { package?: string; [k: string]: unknown };
  [k: string]: unknown;
};

const SUFIJO_DEV = '.dev';

export function aplicarVariante<T extends ConfigBase>(config: T, variante: string | undefined): T {
  if (variante !== 'development') return config;

  const ios = config.ios && { ...config.ios };
  if (ios) {
    if (ios.bundleIdentifier) ios.bundleIdentifier += SUFIJO_DEV;
    // Los universal links de producción no son de esta app: si los reclamara, iOS podría
    // abrir los links reales en la de desarrollo.
    delete ios.associatedDomains;
  }
  const android = config.android && { ...config.android };
  if (android?.package) android.package += SUFIJO_DEV;

  return {
    ...config,
    name: `${config.name} Dev`,
    // Esquema propio por lo mismo: `hushsplit://` tiene que abrir siempre la productiva.
    scheme: 'hushsplit-dev',
    ...(ios && { ios }),
    ...(android && { android }),
  };
}

// app.json sigue siendo la fuente; esto sólo ajusta la variante de desarrollo.
// APP_VARIANT lo pone eas.json en el perfil `development`. La función vive acá y no en
// src/: Expo evalúa este archivo sin transpilar los .ts que importe.
export default ({ config }: ConfigContext): ExpoConfig =>
  aplicarVariante(config as ExpoConfig, process.env.APP_VARIANT);
