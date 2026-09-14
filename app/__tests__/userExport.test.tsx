import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import UserScreen from '@/app/(tabs)/user';

/**
 * T-124 · SEC L-F: exportar el respaldo ahora avisa ANTES de armar el archivo
 * (contiene datos de otras personas del grupo, en claro). Este test cubre lo
 * que `compartirArchivoTemporal.test.ts` no puede: que cancelar la
 * confirmación no llega a escribir/compartir nada.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const mockCompartir: jest.Mock = jest.fn(() => Promise.resolve());
jest.mock('@/src/services/compartirArchivoTemporal', () => ({
  compartirArchivoTemporal: (nombre: string, contenido: string, titulo: string) =>
    mockCompartir(nombre, contenido, titulo),
}));

describe('exportar respaldo desde "Yo" (T-124 · SEC L-F)', () => {
  beforeEach(() => {
    mockCompartir.mockClear();
    jest.spyOn(Alert, 'alert');
  });

  it('tocar "Exportar datos" muestra el aviso y NO comparte todavía', () => {
    const r = render(<UserScreen />);
    fireEvent.press(r.getByText('backup.export'));

    expect(Alert.alert).toHaveBeenCalledWith(
      'backup.export_warning_title',
      'backup.export_warning_body',
      expect.any(Array),
    );
    expect(mockCompartir).not.toHaveBeenCalled();
  });

  it('cancelar el aviso no escribe ni comparte el archivo', () => {
    const r = render(<UserScreen />);
    fireEvent.press(r.getByText('backup.export'));

    const botones = (Alert.alert as jest.Mock).mock.calls[0][2];
    const cancelar = botones.find((b: { text: string }) => b.text === 'common.cancel');
    cancelar.onPress?.();

    expect(mockCompartir).not.toHaveBeenCalled();
  });

  it('confirmar el aviso comparte el respaldo vía compartirArchivoTemporal', async () => {
    const r = render(<UserScreen />);
    fireEvent.press(r.getByText('backup.export'));

    const botones = (Alert.alert as jest.Mock).mock.calls[0][2];
    const confirmar = botones.find((b: { text: string }) => b.text === 'backup.export_warning_confirm');
    await confirmar.onPress?.();

    expect(mockCompartir).toHaveBeenCalledWith(
      expect.stringContaining('splitp2p-backup'),
      expect.any(String),
      'backup.export',
    );
  });
});
