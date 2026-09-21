import { AVISO_GASTOS_GRUPO, LIMITE_GASTOS_GRUPO } from '@/src/constants/groupLimits';

/** ¿Corresponde mostrar el aviso de traspaso? (entre el umbral y el límite duro, sin incluirlo) */
export function debeAvisar(count: number): boolean {
  return count >= AVISO_GASTOS_GRUPO && count < LIMITE_GASTOS_GRUPO;
}

/** ¿El grupo ya alcanzó el límite duro? (no se puede cargar un gasto más) */
export function estaBloqueado(count: number): boolean {
  return count >= LIMITE_GASTOS_GRUPO;
}
