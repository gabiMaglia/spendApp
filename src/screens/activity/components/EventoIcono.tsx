import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

import { conAlfa } from '@/src/skins/color';
import { GLIFOS, type IdGlifo } from '@/src/components/glifos';
import { DIBUJOS_CATEGORIA, idIconoCategoria } from '@/src/components/iconosCategoria';
import { tinteDeCategoria } from '@/src/screens/expense/components/GrillaCategorias';
import { useColors, useSkinTokens } from '@/src/skins/useSkin';

const LADO = 40;
const GLIFO_CUBO = 19;           // ≈ 47% del cubo, igual que CuboIcono
const R_SELLO = 9.5;             // sello de 19 px, anillo incluido
const ANILLO = 2.5;
const GLIFO_SELLO = 11;
const CENTRO_SELLO = LADO + 5 - R_SELLO; // asoma 5 px por abajo-derecha
const ES_INGRESO: ReadonlySet<string> = new Set(['income', 'salary', 'freelance']);

const escala = (lado: number, x: number, y: number) =>
  `translate(${x} ${y}) scale(${lado / 24})`;

/**
 * Ícono de una fila de Actividad (T-294): cubo de la categoría + sello de la acción.
 * Va en UN solo Svg (fondo, dibujo, anillo y sello) porque el feed monta decenas de
 * filas y el presupuesto de nodos host (T-216) no admite una vista por pieza.
 */
function EventoIconoBase({ categoria, tinte, sello, colorSello, apagado }: {
  /** Dibujo del cubo: categoría del gasto, `income` o `saldar`. Si no existe, cae a «other». */
  categoria: string;
  /** Color del cubo; si falta, el de la categoría (los ingresos, el verde semántico). */
  tinte?: string;
  /** Glifo del sello y su color (props primitivas para que la memo sirva). */
  sello?: IdGlifo;
  colorSello?: string;
  /** Borrado: el cubo va gris y tenue para que no compita con los gastos vivos. */
  apagado?: boolean;
}) {
  const c = useColors();
  const { colors } = useSkinTokens();
  const ingreso = ES_INGRESO.has(categoria);
  const color = apagado ? c.textTertiary
    : tinte ?? (ingreso ? c.semantic.positive : tinteDeCategoria(c.category, categoria));
  const id = idIconoCategoria(ingreso ? 'income' : categoria);
  const { b, d } = DIBUJOS_CATEGORIA[id];
  const pos = (LADO - GLIFO_CUBO) / 2;
  const g = sello ? GLIFOS[sello] : null;
  return (
    <Svg
      testID={apagado ? 'evento-icono-apagado' : 'evento-icono'}
      accessible={false}
      width={LADO} height={LADO} viewBox={`0 0 ${LADO} ${LADO}`}
      // El fondo del cubo es el propio Svg (un nodo menos por fila); el sello asoma por fuera.
      style={{ overflow: 'visible', opacity: apagado ? 0.6 : 1, backgroundColor: conAlfa(color, 0.14), borderRadius: LADO * 0.3, borderCurve: 'continuous' }}
      fill="none" strokeLinecap="round" strokeLinejoin="round"
    >
      <Path
        testID={`icono-categoria-${id}-a`}
        d={d === '' ? b : `${b}${d}`}
        transform={escala(GLIFO_CUBO, pos, pos)}
        stroke={color} strokeWidth={1.8} fill={conAlfa(color, 0.3)}
      />
      {g && (
        <>
          {/* El anillo del color de la superficie separa el sello del cubo. */}
          <Circle
            testID={`evento-sello-${sello}`}
            cx={CENTRO_SELLO} cy={CENTRO_SELLO} r={R_SELLO - ANILLO / 2}
            fill={colorSello} stroke={c.surface} strokeWidth={ANILLO}
          />
          <Path
            d={`${g.b}${g.d}`}
            transform={escala(GLIFO_SELLO, CENTRO_SELLO - GLIFO_SELLO / 2, CENTRO_SELLO - GLIFO_SELLO / 2)}
            stroke={colors.sobreVelo} strokeWidth={2.6} fill="none"
          />
        </>
      )}
    </Svg>
  );
}

export const EventoIcono = React.memo(EventoIconoBase);
