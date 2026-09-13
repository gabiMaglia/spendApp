import { destinoDeUrlExterna } from '@/src/utils/intencionNativa';

/** Toda URL que llega del sistema pasa por la lista blanca (T-095). */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return destinoDeUrlExterna(path);
}
