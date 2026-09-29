import { useState } from 'react';

import { actualizarMiPerfil } from '@/src/store/miPerfil';
import type { User } from '@/src/types/models';
import { cambiosDePerfil, perfilDraftValido } from '@/src/screens/cuenta/perfilDeCuenta';

/**
 * Un solo botón/hoja para nombre y email (PO 2026-09-22): antes de esto había
 * dos hojas separadas. Apple sólo manda el email en el primer login de cada
 * Apple ID (y nunca si el usuario elige "Ocultar mi correo") — a diferencia
 * de Google, que siempre lo trae. Editarlo a mano es la única forma de que
 * quien entra con Apple pueda verlo/completarlo, igual que ya pasa con el
 * nombre (`mergeProviderUser`: lo guardado localmente gana sobre el proveedor).
 */
export function useEditarPerfil(currentUser: User | null) {
  const [editingProfile, setEditingProfile] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftEmail, setDraftEmail] = useState('');

  function openEditProfile() {
    setDraftName(currentUser?.name ?? '');
    setDraftEmail(currentUser?.email ?? '');
    setEditingProfile(true);
  }

  // Google SIEMPRE manda el email y es el dato de la cuenta con la que se
  // entra — editarlo acá lo desincroniza de la cuenta real sin arreglar nada
  // (PO 2026-09-22). Apple es el caso contrario: sólo lo manda una vez y a
  // veces nunca, así que ahí sí hace falta poder completarlo/corregirlo.
  const emailEditable = currentUser?.authProvider !== 'google';

  function handleSaveProfile() {
    const cambios = cambiosDePerfil(draftName, draftEmail, emailEditable);
    if (!cambios) return;
    if (!actualizarMiPerfil(cambios)) return;
    setEditingProfile(false);
  }

  return {
    editingProfile,
    cerrar: () => setEditingProfile(false),
    draftName, setDraftName,
    draftEmail, setDraftEmail,
    emailEditable,
    valido: perfilDraftValido(draftName, draftEmail, emailEditable),
    openEditProfile,
    handleSaveProfile,
  };
}
