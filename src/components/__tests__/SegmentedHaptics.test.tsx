import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Segmented } from '../Band';
import { useSettingsStore } from '@/src/store/settingsStore';
import { hapticSelection } from '@/src/utils/haptics';

jest.mock('@/src/utils/haptics', () => ({ hapticSelection: jest.fn() }));

/**
 * feat/reskin: el control segmentado nativo de iOS da un «tic» de selección al
 * cambiar. Lo da `Segmented` mismo, no cada pantalla (había cuatro que lo
 * disparaban a mano y el resto, nada).
 */
describe('Segmented — haptic de selección', () => {
  const opciones = [
    { key: 'a' as const, label: 'Activos' },
    { key: 'b' as const, label: 'Archivados' },
  ];

  beforeEach(() => { (hapticSelection as jest.Mock).mockClear(); });

  it.each([
    ['default', 'control'],
    ['default', 'tabs'],
    ['aero', 'control'],
    ['aero', 'tabs'],
  ] as const)('skin %s, variante %s: cambiar de opción da un tic', (skin, variant) => {
    useSettingsStore.setState({ skin });
    const onChange = jest.fn();
    const r = render(<Segmented variant={variant} options={opciones} value="a" onChange={onChange} />);
    fireEvent.press(r.getByText('Archivados'));
    expect(hapticSelection).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('tocar la opción ya elegida no da tic', () => {
    const onChange = jest.fn();
    const r = render(<Segmented options={opciones} value="a" onChange={onChange} />);
    fireEvent.press(r.getByText('Activos'));
    expect(hapticSelection).not.toHaveBeenCalled();
  });
});
