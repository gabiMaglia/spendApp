import { Alert } from 'react-native';
import { exportarDiagnostico } from '../exportDiagnostico';
import { listErrors } from '../errorLog';

const mockCompartir: jest.Mock = jest.fn(() => Promise.resolve());
jest.mock('../compartirArchivoTemporal', () => ({
  compartirArchivoTemporal: (nombre: string, contenido: string, titulo: string) =>
    mockCompartir(nombre, contenido, titulo),
}));

jest.mock('../errorLog', () => ({
  diagnosticoFileName: () => 'diagnostico-2026.json',
  listErrors: jest.fn(),
  serializeErrorLog: () => '{"errors":[]}',
}));

describe('exportarDiagnostico (T-124 · SEC L-F)', () => {
  beforeEach(() => {
    mockCompartir.mockClear();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  it('sin errores anotados, no comparte nada', async () => {
    (listErrors as jest.Mock).mockReturnValue([]);

    await exportarDiagnostico({ dialogTitle: 'Diagnóstico', error: 'Error' });

    expect(mockCompartir).not.toHaveBeenCalled();
  });

  // T-124 · SEC L-F: el diagnóstico usa el MISMO helper que el respaldo — el
  // que borra el archivo temporal al volver, no una copia con la misma lógica.
  it('con errores, comparte vía compartirArchivoTemporal (el helper que borra)', async () => {
    (listErrors as jest.Mock).mockReturnValue([{ message: 'x' }]);

    await exportarDiagnostico({ dialogTitle: 'Diagnóstico', error: 'Error' });

    expect(mockCompartir).toHaveBeenCalledWith('diagnostico-2026.json', '{"errors":[]}', 'Diagnóstico');
  });

  it('si compartir falla, avisa con el texto de error', async () => {
    (listErrors as jest.Mock).mockReturnValue([{ message: 'x' }]);
    mockCompartir.mockImplementationOnce(() => Promise.reject(new Error('falló')));

    await exportarDiagnostico({ dialogTitle: 'Diagnóstico', error: 'Error al exportar' });

    expect(Alert.alert).toHaveBeenCalledWith('Error al exportar');
  });
});
