import React from 'react';
import type { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BottomSheet, SheetOption } from '@/src/components/Sheet';
import { AbanicoCubos } from '@/src/components/menu/AbanicoCubos';
import type { OpcionCubo } from '@/src/components/menu/tipos';
import { useSkin } from '@/src/skins/useSkin';
import { describirDia, diasElegibles, mismoDia } from '@/src/utils/diasElegibles';

/**
 * Selector de fecha de Nuevo gasto y de Saldar (T-282): en Aero, una fila de cubos
 * (día y mes) que sale del control; en Clásico, la hoja de siempre. Una sola lista,
 * con el idioma activo; elegir llama `onElegir` y cierra, en los dos skins.
 */
export function HojaFecha({
  visible, onClose, ancla, date, onElegir, titulo, soloMesCorriente = false, testID,
}: {
  visible: boolean;
  onClose: () => void;
  ancla: React.RefObject<View | null>;
  date: Date;
  onElegir: (d: Date) => void;
  titulo: string;
  /** Gasto personal: un mes cerrado ya arrastró su saldo (T-259). */
  soloMesCorriente?: boolean;
  testID?: string;
}) {
  const { t, i18n } = useTranslation();
  const { skin } = useSkin();

  const hoy = new Date();
  const dias = diasElegibles(soloMesCorriente);
  const info = dias.map(d => describirDia(d, hoy, i18n.language, { hoy: t('common.today'), ayer: t('common.yesterday') }));
  const actual = dias.find(d => mismoDia(d, date))?.getTime();
  const elegir = (ms: number) => onElegir(dias.find(d => d.getTime() === ms) ?? new Date(ms));

  if (skin.flags.soft) {
    const opciones: OpcionCubo<number>[] = dias.map((d, i) => ({
      valor: d.getTime(), tinte: skin.colors.brand.primary, etiqueta: info[i].nombre,
      fecha: { dia: info[i].dia, mes: info[i].mes },
    }));
    return (
      <AbanicoCubos
        visible={visible} onClose={onClose} ancla={ancla} orientacion="fila"
        opciones={opciones} seleccionado={actual} onElegir={elegir}
        accessibilityLabel={titulo} etiquetaCerrar={t('common.close')} testID={testID}
      />
    );
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} title={titulo}>
      {dias.map((d, i) => (
        <SheetOption
          key={d.getTime()} icon="calendar-outline" label={info[i].nombre}
          sublabel={i > 1 ? info[i].larga : undefined} selected={d.getTime() === actual}
          onPress={() => { elegir(d.getTime()); onClose(); }} last={i === dias.length - 1}
        />
      ))}
    </BottomSheet>
  );
}
