import { sanitizeUserName } from '@/src/utils/sanitizeUserName';
import { sanitizeEmail } from '@/src/utils/sanitizeEmail';

/** El email es opcional (puede quedar vacío); si se escribe algo, tiene que
 *  tener forma de email. El nombre siempre es obligatorio. */
export function perfilDraftValido(draftName: string, draftEmail: string, emailEditable: boolean): boolean {
  if (!sanitizeUserName(draftName)) return false;
  if (!emailEditable) return true;
  return draftEmail.trim() === '' || !!sanitizeEmail(draftEmail);
}

/** Lo que se guarda del borrador, o `null` si no hay nada válido que guardar. */
export function cambiosDePerfil(
  draftName: string, draftEmail: string, emailEditable: boolean,
): { name: string; email?: string } | null {
  const cleanName = sanitizeUserName(draftName);
  if (!cleanName) return null;
  const cambios: { name: string; email?: string } = { name: cleanName };
  if (emailEditable) {
    const cleanEmail = draftEmail.trim() === '' ? '' : sanitizeEmail(draftEmail);
    if (cleanEmail === null) return null;
    cambios.email = cleanEmail;
  }
  return cambios;
}

/** `parseBackup` tira errores con clave i18n `backup.*`; cualquier otra cosa
 *  (JSON roto, archivo ilegible) se muestra como formato inválido. */
export function claveDeErrorDeImport(e: unknown): string {
  const m = (e as { message?: unknown } | null | undefined)?.message;
  const msg: string = typeof m === 'string' ? m : '';
  return msg.startsWith('backup.') ? msg : 'backup.error_invalid_format';
}
