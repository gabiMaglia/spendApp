import React from 'react';
import { Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';

import { CuboIcono } from '@/src/components/CuboIcono';
import { AbanicoCubos } from '@/src/components/menu/AbanicoCubos';
import type { OpcionCubo } from '@/src/components/menu/tipos';
import { useAbanicoAnclado } from '@/src/components/menu/useAbanicoAnclado';
import { useSkin } from '@/src/skins/useSkin';
import type { PersonalCategory } from '@/src/types/models';
import { hapticSelection } from '@/src/utils/haptics';
import { CATEGORIES } from '@/src/screens/expense/repartoDeGasto';
import { tinteDeCategoria } from '@/src/screens/expense/components/GrillaCategorias';

/**
 * El cubo de categoría de la tarjeta del gasto: tocarlo despliega la columna de
 * cubos desde su propio lugar (T-283). El `t()` vive acá; el abanico recibe las
 * opciones ya traducidas.
 */
export function CuboCategoria({
  value, onChange,
}: { value: PersonalCategory; onChange: (c: PersonalCategory) => void }) {
  const { t } = useTranslation();
  const { skin } = useSkin();
  const { ancla, abierto, abrir, cerrar } = useAbanicoAnclado();

  const actual = CATEGORIES.find(x => x.id === value) ?? CATEGORIES[CATEGORIES.length - 1];
  const tinte = (id: string) => tinteDeCategoria(skin.colors.category, id);
  const opciones: OpcionCubo<PersonalCategory>[] = CATEGORIES.map(x => ({
    valor: x.id, icono: x.icon, tinte: tinte(x.id), etiqueta: t(`categories.${x.id}`),
  }));

  const elegir = (v: PersonalCategory) => {
    if (v !== value) hapticSelection();
    onChange(v);
  };

  return (
    <>
      <Pressable
        ref={ancla}
        collapsable={false}
        testID="selector-categoria-boton"
        accessibilityRole="button"
        accessibilityLabel={`${t('expense.category_selector_label')}: ${t(`categories.${actual.id}`)}`}
        accessibilityState={{ expanded: abierto }}
        onPress={abrir}
      >
        <CuboIcono icono={actual.icon} tinte={tinte(actual.id)} />
      </Pressable>
      <AbanicoCubos
        visible={abierto} onClose={cerrar} ancla={ancla}
        opciones={opciones} seleccionado={value} onElegir={elegir}
        accessibilityLabel={t('expense.category_selector_label')} etiquetaCerrar={t('common.close')}
        testID="selector-categoria"
      />
    </>
  );
}
