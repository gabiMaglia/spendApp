import { act, renderHook } from '@testing-library/react-native';

import { useMonedaDelGasto } from '../useMonedaDelGasto';
import { useSettingsStore } from '@/src/store/settingsStore';

type Props = { groupId: string; groupCurrency?: 'ARS' | 'USD' | 'CLP' };

beforeEach(() => {
  useSettingsStore.setState({ displayCurrency: 'ARS', lastPersonalCurrency: null });
});

const montar = (p: Props) =>
  renderHook((props: Props) => useMonedaDelGasto(props.groupId, props.groupCurrency), { initialProps: p });

describe('moneda del gasto (T-255)', () => {
  it('sin grupo y sin historial usa la moneda de pantalla', () => {
    useSettingsStore.setState({ displayCurrency: 'BRL' });
    const { result } = montar({ groupId: '' });
    expect(result.current.currency).toBe('BRL');
    expect(result.current.editable).toBe(true);
  });

  it('sin grupo propone la última moneda usada en un gasto personal', () => {
    useSettingsStore.setState({ displayCurrency: 'BRL', lastPersonalCurrency: 'CLP' });
    expect(montar({ groupId: '' }).result.current.currency).toBe('CLP');
  });

  it('elegir una moneda la cambia', () => {
    const { result } = montar({ groupId: '' });
    act(() => result.current.setCurrency('USD'));
    expect(result.current.currency).toBe('USD');
  });

  it('con grupo manda la moneda del grupo y no es editable', () => {
    const { result } = montar({ groupId: 'g', groupCurrency: 'CLP' });
    expect(result.current.currency).toBe('CLP');
    expect(result.current.editable).toBe(false);
  });

  it('con un grupo que ya no existe (borrado, deep link viejo) no es editable', () => {
    const { result } = montar({ groupId: 'fantasma' });
    expect(result.current.editable).toBe(false);
  });

  it('al pasar de grupo a «Sin grupo» vuelve a la moneda por defecto, no a la del grupo', () => {
    useSettingsStore.setState({ lastPersonalCurrency: 'USD' });
    const { result, rerender } = montar({ groupId: 'g', groupCurrency: 'CLP' });
    rerender({ groupId: '' });
    expect(result.current.currency).toBe('USD');
  });

  it('lo elegido se descarta al cambiar de grupo y volver', () => {
    const { result, rerender } = montar({ groupId: '' });
    act(() => result.current.setCurrency('CLP'));
    rerender({ groupId: 'g', groupCurrency: 'ARS' });
    rerender({ groupId: '' });
    expect(result.current.currency).toBe('ARS');
  });
});

describe('moneda al editar una entrada personal (T-257)', () => {
  it('arranca en la moneda de la entrada, por encima de la última usada, y sigue siendo elegible', () => {
    useSettingsStore.setState({ displayCurrency: 'BRL', lastPersonalCurrency: 'CLP' });
    const { result } = renderHook(() => useMonedaDelGasto('', undefined, 'USD'));
    expect(result.current.currency).toBe('USD');
    expect(result.current.editable).toBe(true);
    act(() => result.current.setCurrency('EUR'));
    expect(result.current.currency).toBe('EUR');
  });
});
