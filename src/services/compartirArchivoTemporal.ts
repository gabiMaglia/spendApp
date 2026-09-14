import { Alert } from 'react-native';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';

/**
 * Escribe un archivo en `Paths.cache`, lo comparte, y lo BORRA al volver
 * (T-124 · SEC L-F).
 *
 * El respaldo (`app/(tabs)/user.tsx#handleExport`) y el diagnóstico
 * (`exportDiagnostico.ts`) escribían acá y nunca borraban: el archivo —con
 * datos de OTRAS personas del grupo en claro— quedaba en el dispositivo para
 * siempre, alcanzable por cualquier app con acceso a esa carpeta y dentro de
 * los backups de iCloud/iTunes que incluyen `Paths.cache`.
 *
 * El archivo es sólo un intermediario para `Sharing.shareAsync` (que pide una
 * URI, no puede compartir un string): una vez que el usuario eligió destino
 * —o canceló, o `shareAsync` falló— ya cumplió su función, de ahí el `finally`.
 *
 * Si no hay `Sharing` disponible, se muestra la ruta y el archivo NO se
 * borra: es la única forma que le queda al usuario de llegar a él (mismo
 * comportamiento que ya tenían las dos pantallas antes de este fix).
 */
export async function compartirArchivoTemporal(
  nombre: string,
  contenido: string,
  titulo: string,
): Promise<void> {
  const file = new File(Paths.cache, nombre);
  file.write(contenido);

  if (!(await Sharing.isAvailableAsync())) {
    Alert.alert(titulo, file.uri);
    return;
  }

  try {
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: titulo });
  } finally {
    // `shareAsync` puede fallar sin haber tocado el archivo: chequear que
    // siga existiendo antes de borrar evita un error sobre un archivo ausente.
    if (file.exists) file.delete();
  }
}
