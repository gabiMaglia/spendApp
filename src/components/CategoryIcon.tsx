import React from 'react';

import { CuboIcono } from '@/src/components/CuboIcono';
import { tinteDeCategoria } from '@/src/screens/expense/components/GrillaCategorias';
import { useColors } from '@/src/skins/useSkin';
import type { CategoryKind } from '@/src/constants/colors';

const ES_INGRESO: ReadonlySet<string> = new Set(['income', 'salary', 'freelance']);

interface CategoryIconProps {
  kind?: CategoryKind;
  size?: number;
}

/** Ícono de categoría de las filas y del detalle: cubo de dos tonos con dibujo propio (T-293). */
export function CategoryIcon({ kind = 'other', size = 40 }: CategoryIconProps) {
  const c = useColors();
  // Los ingresos personales comparten el dibujo de ingreso y el verde semántico (PO).
  if (ES_INGRESO.has(kind)) return <CuboIcono categoria="income" tinte={c.semantic.positive} tamano={size} />;
  return <CuboIcono categoria={kind} tinte={tinteDeCategoria(c.category, kind)} tamano={size} />;
}

export type { CategoryKind };
