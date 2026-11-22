import React from 'react';

import { CuboIcono } from '@/src/components/CuboIcono';
import { tinteDeCategoria } from '@/src/screens/expense/components/GrillaCategorias';
import { useColors } from '@/src/skins/useSkin';
import type { CategoryKind } from '@/src/constants/colors';

interface CategoryIconProps {
  kind?: CategoryKind;
  size?: number;
}

/** Ícono de categoría de las filas y del detalle: cubo de dos tonos con dibujo propio (T-293). */
export function CategoryIcon({ kind = 'other', size = 40 }: CategoryIconProps) {
  const c = useColors();
  // Las categorías de ingreso (sueldo, freelance) no tienen color ni dibujo propios: caen a «otro».
  return <CuboIcono categoria={kind} tinte={tinteDeCategoria(c.category, kind)} tamano={size} />;
}

export type { CategoryKind };
