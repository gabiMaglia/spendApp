import { createSecureStorage } from '@/src/utils/secureStorage';
import { recordError } from '@/src/services/errorLog';

/**
 * Anota un problema de plantilla recurrente a lo sumo UNA vez por
 * (plantilla, tipo). Un fallo persistente se reintenta en cada apertura y, sin
 * esto, desplazaría del anillo de 50 errores a todo lo demás (T-251, M1).
 *
 * La marca es persistente y guarda sólo ids y tipos, nunca datos de dominio.
 * Sin scope de cuenta, igual que el registro de errores: los ids son UUID.
 */
const storage = createSecureStorage('notices');
const KEY = 'recurring_problems_seen_v1';
const MAX_MARCAS = 200;

function leer(): string[] {
  try {
    const raw = storage.getString(KEY);
    const d = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(d) ? (d as string[]) : [];
  } catch {
    return [];
  }
}

export function anotarProblemaUnaVez(p: { id: string; kind: string; message: string }): void {
  try {
    const marca = `${p.id}:${p.kind}`;
    const vistas = leer();
    if (vistas.includes(marca)) return;
    recordError({ message: `${p.message} (${p.id})`, fatal: false, screen: 'recurring' });
    storage.set(KEY, JSON.stringify([...vistas, marca].slice(-MAX_MARCAS)));
  } catch {
    /* anotar no puede romper el arranque */
  }
}
