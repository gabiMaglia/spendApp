import { MAIL_SOPORTE } from '@/src/constants/legal';

/**
 * `mailto:` de una denuncia de contenido (T-235, Apple 1.2). Sin backend que
 * lea comentarios, la denuncia viaja por mail con lo necesario para actuar:
 * quién lo escribió, qué dice y en qué gasto. `asunto` y `cuerpo` vienen ya
 * traducidos; los datos van debajo del cuerpo.
 *
 * `autorId` es el id de la app del autor: con él se encuentra al usuario de
 * Supabase a banear (T-238, `docs/MODERACION.md`).
 */
export function mailDeDenuncia({
  autor, autorId, texto, gastoId, asunto, cuerpo,
}: { autor: string; autorId: string; texto: string; gastoId: string; asunto: string; cuerpo: string }): string {
  const detalle = `${cuerpo}\n\n— ${autor}: «${texto}»\nAutor: ${autorId}\nID: ${gastoId}`;
  return `mailto:${MAIL_SOPORTE}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(detalle)}`;
}
