import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { Ionicons } from '@expo/vector-icons';
import { SectionLabel, Segmented, SplitStat, StatGrid } from '../Band';
import { crearRegistroDeMontos } from '@/src/utils/montoRodanteRegistry';
import { formatMoney } from '@/src/constants/currencies';

/**
 * `Segmented` tiene dos variantes porque tiene dos trabajos: `control` elige
 * dentro de un formulario, `tabs` separa el contenido de una pantalla. Lo que
 * se prueba es el comportamiento, no cómo se ve — los estilos no se testean
 * por regla del proyecto.
 */
describe('Segmented', () => {
  const opciones = [
    { key: 'a' as const, label: 'Activos' },
    { key: 'b' as const, label: 'Archivados' },
  ];

  it.each(['control', 'tabs'] as const)('en %s, tocar una opción la elige', variant => {
    const onChange = jest.fn();
    const r = render(
      <Segmented variant={variant} options={opciones} value="a" onChange={onChange} />,
    );
    fireEvent.press(r.getByText('Archivados'));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it.each(['control', 'tabs'] as const)('en %s, tocar la ya elegida no rompe nada', variant => {
    const onChange = jest.fn();
    const r = render(
      <Segmented variant={variant} options={opciones} value="a" onChange={onChange} />,
    );
    fireEvent.press(r.getByText('Activos'));
    expect(onChange).toHaveBeenCalledWith('a');
  });

  // Un lector de pantalla tiene que poder decir cuál está activa.
  it('en tabs, la activa se anuncia como seleccionada', () => {
    const r = render(<Segmented variant="tabs" options={opciones} value="b" onChange={() => {}} />);
    const tabs = r.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs.filter(t => t.props.accessibilityState?.selected)).toHaveLength(1);
    expect(tabs.find(t => t.props.accessibilityState?.selected)).toBe(
      tabs[1],  // 'Archivados', que es `value`
    );
  });

  /**
   * **Pestañas «T invertida»** (PO, 2026-09-12): ícono y texto flotando en el centro de la
   * celda, una línea vertical entre celdas y una horizontal abajo, y la activa con fondo.
   * El look no se testea; lo que sí: que el ícono se dibuje cuando la opción lo trae, con
   * el estado de la pestaña, y que sin ícono no se invente uno.
   */
  it('en tabs, cada opción con ícono lo dibuja, y sin ícono no aparece ninguno', () => {
    const conIconos = [
      { key: 'a' as const, label: 'Gasto',   icon: 'trending-down-outline' as const },
      { key: 'b' as const, label: 'Ingreso', icon: 'trending-up-outline' as const },
    ];
    const r = render(<Segmented variant="tabs" options={conIconos} value="a" onChange={() => {}} />);
    const iconos = r.UNSAFE_getAllByType(Ionicons).map(i => i.props.name);
    expect(iconos).toEqual(['trending-down-outline', 'trending-up-outline']);

    const sin = render(<Segmented variant="tabs" options={opciones} value="a" onChange={() => {}} />);
    expect(sin.UNSAFE_queryAllByType(Ionicons)).toHaveLength(0);
  });

  it('en tabs con scroll, los íconos también se dibujan', () => {
    const r = render(
      <Segmented
        variant="tabs" scroll value="t" onChange={() => {}}
        options={[{ key: 't', label: 'Todos', icon: 'apps-outline' }, { key: 'g', label: 'Asado', icon: 'people-outline' }]}
      />,
    );
    expect(r.UNSAFE_getAllByType(Ionicons).map(i => i.props.name)).toEqual(['apps-outline', 'people-outline']);
  });

  /**
   * Con muchas opciones de largo variable —los filtros por grupo de Actividad—
   * las pestañas van en scroll horizontal. Sin eso, N pestañas con `flex: 1`
   * se aprietan hasta que los nombres se cortan.
   */
  it('en scroll, entran todas las opciones', () => {
    const muchas = ['Todos', 'Asado', 'Viaje a Bariloche', 'Depto', 'Finde largo']
      .map(l => ({ key: l, label: l }));
    const r = render(
      <Segmented variant="tabs" scroll options={muchas} value="Todos" onChange={() => {}} />,
    );
    muchas.forEach(o => expect(r.getByText(o.label)).toBeTruthy());
  });

  /**
   * T-108 — Grupos pega el selector Activos/Archivados al primer elemento de
   * la lista, y para eso el borde de la "T invertida" tiene que pasar de abajo
   * a arriba (si no, quedarían las dos líneas — la de abajo del selector y la
   * de arriba de la banda — donde tiene que haber una sola, igual que
   * `Band noTop`). El resto de la app no pasa esta prop y no puede cambiar.
   */
  it('sin `borde`, se comporta EXACTO como antes (default abajo) — no rompe a los consumidores existentes', () => {
    const r = render(<Segmented variant="tabs" options={opciones} value="a" onChange={() => {}} />);
    const estilo = StyleSheet.flatten(r.getByTestId('segmented-tabs-wrap').props.style);
    expect(estilo.borderBottomWidth).toBe(1);
    expect(estilo.borderTopWidth ?? 0).toBe(0);
  });

  it('con `borde="arriba"`, usa esa variante en vez de la de abajo', () => {
    const r = render(<Segmented variant="tabs" borde="arriba" options={opciones} value="a" onChange={() => {}} />);
    const estilo = StyleSheet.flatten(r.getByTestId('segmented-tabs-wrap').props.style);
    expect(estilo.borderTopWidth).toBe(1);
    expect(estilo.borderBottomWidth ?? 0).toBe(0);
  });

  // T-108 (agregado del PO): Actividad quiere línea arriba Y abajo.
  it('con `borde="ambos"`, dibuja las dos líneas', () => {
    const r = render(<Segmented variant="tabs" borde="ambos" options={opciones} value="a" onChange={() => {}} />);
    const estilo = StyleSheet.flatten(r.getByTestId('segmented-tabs-wrap').props.style);
    expect(estilo.borderTopWidth).toBe(1);
    expect(estilo.borderBottomWidth).toBe(1);
  });
});

/**
 * T-108 — el aire antes de una lista agrupable se dobla PANTALLA POR PANTALLA,
 * sin tocar el resto de los usos de `SectionLabel` (por ej. las de Actividad
 * entre un grupo de fecha y el siguiente). `topOverride` reemplaza el
 * `paddingTop` de este `SectionLabel` puntual sin afectar el default de los
 * demás.
 */
describe('SectionLabel', () => {
  it('sin topOverride, usa el paddingTop de siempre (default, no rompe nada)', () => {
    const r = render(<SectionLabel label="X" testID="sl" />);
    const estilo = StyleSheet.flatten(r.getByTestId('sl').props.style);
    expect(estilo.paddingTop).toBe(22);
  });

  it('con topOverride, reemplaza el paddingTop por el valor pedido', () => {
    const r = render(<SectionLabel label="X" topOverride={40} testID="sl" />);
    const estilo = StyleSheet.flatten(r.getByTestId('sl').props.style);
    expect(estilo.paddingTop).toBe(40);
  });
});

/**
 * `SplitStat` — igual que `StatGrid` más abajo: sin `id` en el item, se
 * comporta como siempre (Text plano); con `id`, el valor rueda (T-106).
 */
describe('SplitStat', () => {
  it('sin id en los items, sigue siendo texto plano (default, no rompe nada)', () => {
    const r = render(
      <SplitStat items={[{ label: 'A', value: '$100' }, { label: 'B', value: '$200' }]} />,
    );
    expect(r.getByText('$100')).toBeTruthy();
    expect(r.getByText('$200')).toBeTruthy();
  });

  it('con id en el item, el valor es accesible igual (rueda vía MontoRodante)', async () => {
    const registro = crearRegistroDeMontos();
    const r = render(
      <SplitStat
        items={[{ label: 'A', value: '$100', id: 'a', minor: 10000, code: 'ARS' }]}
        registry={registro}
      />,
    );
    // Primera aparición: monta con la semilla y pasa al real al frame
    // siguiente (T-106) — se espera ese asentamiento, no se testea la animación.
    expect(await r.findByLabelText('$100')).toBeTruthy();
  });
});

/**
 * `SplitStat` reparte N celdas en UNA fila: con cuatro, cada una queda de un
 * cuarto de ancho y los montos con miles no entran. La grilla les da la mitad.
 */
describe('StatGrid', () => {
  const items = [
    { label: 'GRUPOS',   value: '3' },
    { label: 'GASTOS',   value: '47' },
    { label: 'TE DEBEN', value: '$12.400,00' },
    { label: 'DEBÉS',    value: '$3.000,00' },
  ] as const;

  it('muestra los cuatro, etiqueta y valor', () => {
    const r = render(<StatGrid items={[...items] as never} />);
    items.forEach(i => {
      expect(r.getByText(i.label)).toBeTruthy();
      expect(r.getByText(i.value)).toBeTruthy();
    });
  });

  // Un monto largo se achica antes que cortarse: «$12.4…» no es un número más
  // chico, es un número que no se puede leer.
  it('los montos se achican en vez de cortarse', () => {
    const r = render(<StatGrid items={[...items] as never} />);
    const monto = r.getByText('$12.400,00');
    expect(monto.props.numberOfLines).toBe(1);
    expect(monto.props.adjustsFontSizeToFit).toBe(true);
  });

  // T-106: Groups pasa `id` en los cuatro items del box — todos ruedan.
  // Groups (T-106): los 4 ruedan — los 2 conteos simples (sin `code`) y los
  // 2 montos (con `code`). Datos propios (no los de `items` arriba): esos
  // son sólo para el rendering plano, sin pasar por `formatMoney`.
  it('con id en los items, los cuatro valores son accesibles igual (ruedan vía MontoRodante)', async () => {
    const registro = crearRegistroDeMontos();
    const conId = [
      { label: 'GRUPOS',   value: '3',  id: 'g1', minor: 3 },
      { label: 'GASTOS',   value: '47', id: 'g2', minor: 47 },
      { label: 'TE DEBEN', value: formatMoney(1240000, 'ARS'), color: undefined, id: 'g3', minor: 1240000, code: 'ARS' as const },
      { label: 'DEBÉS',    value: formatMoney(300000, 'ARS'),  color: undefined, id: 'g4', minor: 300000,  code: 'ARS' as const },
    ];
    const r = render(<StatGrid items={conId as never} registry={registro} />);
    // Primera aparición de cada uno: esperar el asentamiento post-semilla (T-106).
    for (const i of conId) {
      expect(await r.findByLabelText(i.value)).toBeTruthy();
    }
  });
});
