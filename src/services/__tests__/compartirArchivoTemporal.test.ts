import { Alert } from 'react-native';
import { compartirArchivoTemporal } from '../compartirArchivoTemporal';

// El mock global de jest-expo para 'expo-file-system' es de la API VIEJA
// (writeAsStringAsync, etc.); este módulo usa la clase `File`/`Paths` nueva
// (SDK 54), así que se reemplaza acá con algo que se comporta como ella.
let mockArchivos: Record<string, { contenido: string; existe: boolean }> = {};

jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string;
    constructor(_dir: unknown, nombre: string) {
      this.uri = `file:///cache/${nombre}`;
    }
    write(contenido: string) {
      mockArchivos[this.uri] = { contenido, existe: true };
    }
    get exists() {
      return mockArchivos[this.uri]?.existe ?? false;
    }
    delete() {
      if (!mockArchivos[this.uri]?.existe) throw new Error('no existe');
      mockArchivos[this.uri].existe = false;
    }
  }
  return { File: MockFile, Paths: { cache: 'CACHE_DIR' } };
});

let mockSharingDisponible = true;
let mockShareAsync: jest.Mock = jest.fn(() => Promise.resolve());
jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => Promise.resolve(mockSharingDisponible),
  shareAsync: (uri: string, opts: unknown) => mockShareAsync(uri, opts),
}));

describe('compartirArchivoTemporal (T-124 · SEC L-F)', () => {
  beforeEach(() => {
    mockArchivos = {};
    mockSharingDisponible = true;
    mockShareAsync = jest.fn(() => Promise.resolve());
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  it('escribe el archivo, comparte, y lo borra al volver', async () => {
    await compartirArchivoTemporal('respaldo.json', '{"a":1}', 'Exportar');

    expect(mockShareAsync).toHaveBeenCalledWith(
      'file:///cache/respaldo.json',
      expect.objectContaining({ dialogTitle: 'Exportar' }),
    );
    // El archivo no queda: es la esencia del fix (SEC L-F).
    expect(mockArchivos['file:///cache/respaldo.json'].existe).toBe(false);
  });

  it('si shareAsync falla, el archivo se borra igual (borrado en el finally)', async () => {
    mockShareAsync = jest.fn(() => Promise.reject(new Error('el usuario cerró el sheet')));

    await expect(
      compartirArchivoTemporal('diagnostico.json', '{}', 'Diagnóstico'),
    ).rejects.toThrow();

    expect(mockArchivos['file:///cache/diagnostico.json'].existe).toBe(false);
  });

  it('sin Sharing disponible, muestra la ruta y NO borra el archivo', async () => {
    mockSharingDisponible = false;

    await compartirArchivoTemporal('respaldo.json', '{"a":1}', 'Exportar');

    expect(Alert.alert).toHaveBeenCalledWith('Exportar', 'file:///cache/respaldo.json');
    expect(mockShareAsync).not.toHaveBeenCalled();
    expect(mockArchivos['file:///cache/respaldo.json'].existe).toBe(true);
  });
});
