import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { Band, useC } from '@/src/components/Band';
import { BandStack } from '@/src/components/skin/BandStack';
import { Colors } from '@/src/constants/colors';
import { useSettingsStore } from '@/src/store/settingsStore';

const Tres = () => (
  <>
    <Band><Text>a</Text></Band>
    <Band noTop><Text>b</Text></Band>
    <Band noTop><Text>c</Text></Band>
  </>
);

describe('Band suelta', () => {
  it('con el Clásico no se envuelve en panel', () => {
    useSettingsStore.setState({ skin: 'default' });
    render(<Band><Text>hola</Text></Band>);
    expect(screen.getByText('hola')).toBeTruthy();
    expect(screen.queryByTestId('skin-panel')).toBeNull();
  });

  it('con Aero se dibuja como panel', () => {
    useSettingsStore.setState({ skin: 'aero' });
    render(<Band><Text>hola</Text></Band>);
    expect(screen.getAllByTestId('skin-panel')).toHaveLength(1);
  });
});

describe('useC', () => {
  function Probe({ out }: { out: { c?: unknown } }) {
    out.c = useC();
    return null;
  }

  it('con el Clásico devuelve los mismos valores que Colors', () => {
    useSettingsStore.setState({ skin: 'default' });
    const out: { c?: unknown } = {};
    render(<Probe out={out} />);
    expect(out.c).toMatchObject(Colors.light);
  });
});

describe('BandStack', () => {
  it('con el Clásico deja los hijos como están', () => {
    useSettingsStore.setState({ skin: 'default' });
    render(<BandStack><Band><Text>a</Text></Band><Band noTop><Text>b</Text></Band></BandStack>);
    expect(screen.getByText('a')).toBeTruthy();
    expect(screen.queryByTestId('skin-panel')).toBeNull();
    expect(screen.queryByTestId('band-stack-divisor')).toBeNull();
  });

  it('unido: un solo panel con divisores entre bandas', () => {
    useSettingsStore.setState({ skin: 'aero' });
    render(
      <BandStack>
        <Band><Text>a</Text></Band>
        <Band noTop><Text>b</Text></Band>
        <Band noTop><Text>c</Text></Band>
      </BandStack>,
    );
    expect(screen.getAllByTestId('skin-panel')).toHaveLength(1);
    expect(screen.getAllByTestId('band-stack-divisor')).toHaveLength(2);
    for (const t of ['a', 'b', 'c']) expect(screen.getByText(t)).toBeTruthy();
  });

  it('separado: un panel por banda', () => {
    useSettingsStore.setState({ skin: 'aero' });
    render(
      <BandStack modo="separado">
        <Band><Text>a</Text></Band>
        <Band noTop><Text>b</Text></Band>
      </BandStack>,
    );
    expect(screen.getAllByTestId('skin-panel')).toHaveLength(2);
    expect(screen.queryByTestId('band-stack-divisor')).toBeNull();
  });

  it('usa el Contenedor recibido por prop', () => {
    useSettingsStore.setState({ skin: 'aero' });
    const Caja = ({ children }: { children: React.ReactNode }) => <>{children}<Text>caja</Text></>;
    render(<BandStack modo="separado" Contenedor={Caja}><Text>a</Text><Text>b</Text></BandStack>);
    expect(screen.getAllByText('caja')).toHaveLength(2);
  });

  it('ignora hijos vacíos', () => {
    useSettingsStore.setState({ skin: 'aero' });
    render(<BandStack>{null}<Band><Text>a</Text></Band>{false}</BandStack>);
    expect(screen.queryByTestId('band-stack-divisor')).toBeNull();
  });

  it('sin hijos no rompe', () => {
    useSettingsStore.setState({ skin: 'aero' });
    render(<Tres />);
    expect(screen.getAllByTestId('skin-panel')).toHaveLength(3);
  });
});
