import { useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';

import { claveDeFallo, elegirAvatarDeGaleria, recortarAAvatar } from '@/src/services/avatar';
import type { Recorte } from '@/src/algorithms/avatarCrop';
import { actualizarMiPerfil } from '@/src/store/miPerfil';

/** Elegir foto de la galería → ajustar el encuadre → guardarla como avatar. */
export function useFotoDePerfil() {
  const { t } = useTranslation();
  /** La imagen elegida, esperando que la persona ajuste el encuadre. */
  const [aRecortar, setARecortar] = useState<{ uri: string; width: number; height: number } | null>(null);

  async function cambiarFoto() {
    const r = await elegirAvatarDeGaleria();
    if (!r.ok) {
      const clave = claveDeFallo(r.motivo);
      if (clave) Alert.alert(t('profile.photo_error_title'), t(clave));
      return;
    }
    // No se guarda todavía: primero se elige QUÉ parte de la foto queda
    // (T-067). Antes se guardaba en el acto y el redimensionado la achataba.
    setARecortar({ uri: r.uri, width: r.width, height: r.height });
  }

  async function confirmarRecorte(recorte: Recorte) {
    const elegida = aRecortar;
    setARecortar(null);
    if (!elegida) return;

    const r = await recortarAAvatar(elegida.uri, recorte);
    if (!r.ok) {
      const clave = claveDeFallo(r.motivo);
      if (clave) Alert.alert(t('profile.photo_error_title'), t(clave));
      return;
    }
    actualizarMiPerfil({ avatar: r.dataUri });
  }

  return { aRecortar, cancelarRecorte: () => setARecortar(null), cambiarFoto, confirmarRecorte };
}
