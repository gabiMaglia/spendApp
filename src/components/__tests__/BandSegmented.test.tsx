import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Segmented, StatGrid } from '../Band';

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
});
