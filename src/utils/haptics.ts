import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * La única puerta a la vibración (T-289). Se pide por intención, no por «fuerza»:
 * qué vibración suena para cada cosa vive en `MAPA_HAPTICO` y se cambia en un solo lugar.
 * Ninguna otra parte de la app importa `expo-haptics` (lo vigila `sinHapticsDirectos.guard`).
 *
 * - abrir:       abrir algo (hoja, abanico, pantalla); toque liviano.
 * - seleccionar: elegir una opción o cambiar de pestaña; tic de selección.
 * - confirmar:   mandar una acción que sigue (enviar, guardar un ajuste); toque medio.
 * - exito:       algo terminó bien (gasto guardado, contacto agregado).
 * - advertencia: no se pudo o hay que mirar dos veces (validación, aviso).
 * - destructivo: borrar o dar de baja; toque pesado, distinto de la advertencia.
 */
export type IntencionHaptica =
  | 'abrir' | 'seleccionar' | 'confirmar' | 'exito' | 'advertencia' | 'destructivo';

export const MAPA_HAPTICO: Record<IntencionHaptica, () => void> = {
  abrir:       () => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); },
  seleccionar: () => { void Haptics.selectionAsync(); },
  confirmar:   () => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); },
  exito:       () => { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); },
  advertencia: () => { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); },
  destructivo: () => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); },
};

export function vibrar(intencion: IntencionHaptica) {
  if (Platform.OS === 'web') return;
  MAPA_HAPTICO[intencion]();
}

export const hapticAbrir       = () => vibrar('abrir');
export const hapticSeleccionar = () => vibrar('seleccionar');
export const hapticConfirmar   = () => vibrar('confirmar');
export const hapticExito       = () => vibrar('exito');
export const hapticAdvertencia = () => vibrar('advertencia');
export const hapticDestructivo = () => vibrar('destructivo');
