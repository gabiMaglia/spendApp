import { Alert } from 'react-native';

import { diagnosticoFileName, listErrors, serializeErrorLog } from './errorLog';
import { compartirArchivoTemporal } from './compartirArchivoTemporal';

/**
 * Comparte el registro de errores (T-078 · §5.4).
 *
 * **Es exactamente el mecanismo del respaldo** (`app/(tabs)/user.tsx`,
 * `handleExport`): archivo en la caché, compartir, borrar al volver (T-124 ·
 * SEC L-F). No se inventa una segunda forma de sacar un archivo del teléfono
 * — las dos pantallas comparten `compartirArchivoTemporal`.
 *
 * Vive en un servicio y no en la pantalla porque lo llaman **dos** lugares: la
 * fila de «Yo» y el botón de la pantalla de recuperación — y la pantalla de
 * recuperación aparece justo cuando la app se rompió, o sea que no puede
 * depender de que la pantalla de «Yo» esté montada.
 *
 * Los textos llegan traducidos: este módulo no llama a `t()`, por la misma
 * razón que `ErrorBoundary` no lo hace.
 */
export async function exportarDiagnostico(textos: {
  dialogTitle: string;
  error: string;
}): Promise<void> {
  try {
    if (listErrors().length === 0) return; // nada que compartir, nada que decir

    await compartirArchivoTemporal(diagnosticoFileName(), serializeErrorLog(), textos.dialogTitle);
  } catch {
    Alert.alert(textos.error);
  }
}
