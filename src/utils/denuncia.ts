import { MAIL_SOPORTE } from '@/src/constants/legal';

/**
 * `mailto:` de una denuncia de contenido (T-235, Apple 1.2). Sin backend que
 * lea comentarios, la denuncia viaja por mail con lo necesario para actuar:
 * quién lo escribió, qué dice y en qué gasto. `asunto` y `cuerpo` vienen ya
 * traducidos; los datos van debajo del cuerpo.
 */
export function mailDeDenuncia({
  autor, texto, gastoId, asunto, cuerpo,
}: { autor: string; texto: string; gastoId: string; asunto: string; cuerpo: string }): string {
  const detalle = `${cuerpo}\n\n— ${autor}: «${texto}»\nID: ${gastoId}`;
  return `mailto:${MAIL_SOPORTE}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(detalle)}`;
}
