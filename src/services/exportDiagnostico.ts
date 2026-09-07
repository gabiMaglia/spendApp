import { Alert } from 'react-native';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';

import { diagnosticoFileName, listErrors, serializeErrorLog } from './errorLog';

/**
 * Comparte el registro de errores (T-078 · §5.4).
 *
 * **Es exactamente el mecanismo del respaldo** (`app/(tabs)/user.tsx`,
 * `handleExport`): archivo en la caché, `Sharing.shareAsync`, y si el sistema
 * no puede compartir, se muestra la ruta. No se inventa una segunda forma de
 * sacar un archivo del teléfono.
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

    const file = new File(Paths.cache, diagnosticoFileName());
    file.write(serializeErrorLog());

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        dialogTitle: textos.dialogTitle,
      });
    } else {
      Alert.alert(textos.dialogTitle, file.uri);
    }
  } catch {
    Alert.alert(textos.error);
  }
}
