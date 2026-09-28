import { excesoDe } from '@/src/sync/nucleo/topes';

/**
 * T-178 (6.4): el registro que excede `excesoDe` no viaja (`sliceEntities`
 * lo excluye al publicar, `acotarDeltaAlGrupo` lo descarta al recibir) —
 * pero hasta ahora eso pasaba EN SILENCIO: el registro quedaba guardado en
 * el store local de quien lo creó, sin viajar nunca, sin que nadie se
 * enterara de la divergencia.
 *
 * Este wrapper corre el MISMO predicado (`excesoDe`) antes de escribir en
 * el store desde cualquier formulario, y traduce el motivo a una clave i18n
 * para mostrarle al usuario por qué no se guardó. No es una regla nueva de
 * tamaño: es la misma, movida más temprano.
 */
export function motivoDeExceso(record: unknown): string | null {
  const motivo = excesoDe(record);
  if (motivo === 'memberIds') return 'sync.record_too_big_members';
  if (motivo === 'bytes') return 'sync.record_too_big_bytes';
  return null;
}
