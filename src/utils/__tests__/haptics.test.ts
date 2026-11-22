import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

import {
  MAPA_HAPTICO, hapticAbrir, hapticAdvertencia, hapticConfirmar,
  hapticDestructivo, hapticExito, hapticSeleccionar, vibrar,
} from '@/src/utils/haptics';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

const impacto = Haptics.impactAsync as jest.Mock;
const notificacion = Haptics.notificationAsync as jest.Mock;
const seleccion = Haptics.selectionAsync as jest.Mock;

describe('haptics — una vibración por intención', () => {
  beforeEach(() => { jest.clearAllMocks(); Platform.OS = 'ios'; });

  it('abrir es un toque liviano', () => {
    hapticAbrir();
    expect(impacto).toHaveBeenCalledWith('light');
  });

  it('seleccionar es el tic de selección', () => {
    hapticSeleccionar();
    expect(seleccion).toHaveBeenCalledTimes(1);
  });

  it('confirmar es un toque medio', () => {
    hapticConfirmar();
    expect(impacto).toHaveBeenCalledWith('medium');
  });

  it('exito es la notificación de éxito', () => {
    hapticExito();
    expect(notificacion).toHaveBeenCalledWith('success');
  });

  it('advertencia es la notificación de advertencia', () => {
    hapticAdvertencia();
    expect(notificacion).toHaveBeenCalledWith('warning');
  });

  it('destructivo es un toque pesado, distinto de la advertencia', () => {
    hapticDestructivo();
    expect(impacto).toHaveBeenCalledWith('heavy');
    expect(notificacion).not.toHaveBeenCalled();
  });

  it('vibrar(intención) usa el mismo mapa que las funciones por intención', () => {
    vibrar('exito');
    expect(notificacion).toHaveBeenCalledWith('success');
    expect(Object.keys(MAPA_HAPTICO).sort()).toEqual(
      ['abrir', 'advertencia', 'confirmar', 'destructivo', 'exito', 'seleccionar'],
    );
  });

  it('en web no vibra nada', () => {
    Platform.OS = 'web';
    (Object.keys(MAPA_HAPTICO) as (keyof typeof MAPA_HAPTICO)[]).forEach(i => vibrar(i));
    expect(impacto).not.toHaveBeenCalled();
    expect(notificacion).not.toHaveBeenCalled();
    expect(seleccion).not.toHaveBeenCalled();
  });
});
