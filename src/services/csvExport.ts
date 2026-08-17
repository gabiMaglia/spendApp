import type { Expense, PersonalEntry, User, Group } from '@/src/types/models';
import { formatMoney } from '@/src/constants/currencies';

/**
 * Export a CSV para abrir en Excel / Google Sheets.
 *
 * Complementa al backup `.splitp2p`, que es para RESTAURAR la app: este formato
 * es para que el usuario mire sus números afuera. Por eso los montos van
 * formateados por moneda (legibles) y además en crudo (menor unidad, para hacer
 * cuentas sin ambigüedad de redondeo).
 *
 * Separador: coma, con comillas cuando hace falta (RFC 4180). Se antepone BOM
 * UTF-8 porque Excel en Windows, sin él, rompe los acentos.
 */

const BOM = '﻿';

/** Escapa un campo según RFC 4180: comillas dobles si trae coma, comilla o salto. */
export function csvField(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: unknown[][]): string {
  return BOM + rows.map(r => r.map(csvField).join(',')).join('\r\n');
}

function isoDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export type ExpenseCsvInput = {
  expenses: Expense[];
  groups: Group[];
  users: User[];
  /** Si viene, sólo se exportan los gastos de ese grupo. */
  groupId?: string;
};

/**
 * Una fila por gasto, con una columna por participante mostrando cuánto le tocó.
 * Los gastos borrados (tombstones) NO se exportan.
 */
export function expensesToCsv({ expenses, groups, users, groupId }: ExpenseCsvInput): string {
  const groupName = (id: string) => groups.find(g => g.id === id)?.name ?? id;
  const userName  = (id: string) => users.find(u => u.id === id)?.name ?? id;

  const visible = expenses
    .filter(e => !e.isDeleted)
    .filter(e => (groupId ? e.groupId === groupId : true))
    .sort((a, b) => a.date - b.date);

  const header = [
    'Fecha', 'Grupo', 'Descripción', 'Categoría', 'Moneda',
    'Monto', 'Monto (menor unidad)', 'Pagó', 'Reparto', 'Participantes', 'Nota',
  ];

  const rows = visible.map(e => [
    isoDate(e.date),
    groupName(e.groupId),
    e.description,
    e.category,
    e.currency,
    formatMoney(e.amount, e.currency),
    e.amount,
    userName(e.paidById),
    e.splitMode,
    e.splits.map(s => `${userName(s.userId)}: ${formatMoney(s.amount, e.currency)}`).join(' · '),
    e.note ?? '',
  ]);

  return toCsv([header, ...rows]);
}

/** Movimientos personales (gastos e ingresos), una fila cada uno. */
export function personalToCsv(entries: PersonalEntry[]): string {
  const visible = entries.filter(e => !e.isDeleted).sort((a, b) => a.date - b.date);

  const header = ['Fecha', 'Tipo', 'Descripción', 'Categoría', 'Moneda', 'Monto', 'Monto (menor unidad)'];
  const rows = visible.map(e => [
    isoDate(e.date),
    e.kind === 'income' ? 'Ingreso' : 'Gasto',
    e.description,
    e.category,
    e.currency,
    formatMoney(e.amount, e.currency),
    e.amount,
  ]);

  return toCsv([header, ...rows]);
}

export function csvFileName(prefix: string, now: number = Date.now()): string {
  return `splitp2p-${prefix}-${isoDate(now)}.csv`;
}
