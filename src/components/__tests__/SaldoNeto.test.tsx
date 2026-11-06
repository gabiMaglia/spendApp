import React from 'react';
import { render } from '@testing-library/react-native';

import { SaldoNeto } from '@/src/components/SaldoNeto';
import { formatMoney } from '@/src/constants/currencies';
import { useSettingsStore } from '@/src/store/settingsStore';

const ARS = (minor: number) => formatMoney(minor, 'ARS');

describe('SaldoNeto', () => {
  it('a favor con desglose: el neto es el número grande y los brutos van debajo', () => {
    const r = render(<SaldoNeto owedToYou={224_712_61} youOwe={120_850_00} code="ARS" />);
    expect(r.getByText('groups.net_in_favor')).toBeTruthy();
    expect(r.getByTestId('saldo-neto-monto').props.children).toBe(ARS(103_862_61));
    expect(r.getByText('groups.stat_owed_to_you')).toBeTruthy();
    expect(r.getByText('groups.stat_you_owe')).toBeTruthy();
    expect(r.getByText(ARS(224_712_61))).toBeTruthy();
    expect(r.getByText(ARS(120_850_00))).toBeTruthy();
  });

  it('en contra: el neto se muestra en positivo con la etiqueta de deuda', () => {
    const r = render(<SaldoNeto owedToYou={5_000} youOwe={12_000} code="ARS" />);
    expect(r.getByText('groups.net_against')).toBeTruthy();
    expect(r.getByTestId('saldo-neto-monto').props.children).toBe(ARS(7_000));
  });

  it('con contraparte nombra a la persona en la dirección que corresponde', () => {
    const favor = render(<SaldoNeto owedToYou={8_000} youOwe={1_000} code="ARS" contraparte="Marina" />);
    expect(favor.getByText('groups.net_they_owe_you({"name":"Marina"})')).toBeTruthy();
    const contra = render(<SaldoNeto owedToYou={1_000} youOwe={8_000} code="ARS" contraparte="Marina" />);
    expect(contra.getByText('groups.net_you_owe_them({"name":"Marina"})')).toBeTruthy();
  });

  it('un solo lado con deuda: sin desglose', () => {
    const r = render(<SaldoNeto owedToYou={8_000} youOwe={0} code="ARS" />);
    expect(r.queryByTestId('saldo-neto-desglose')).toBeNull();
  });

  it('todo en cero: Saldado, aunque haya contraparte, y sin desglose', () => {
    const r = render(<SaldoNeto owedToYou={0} youOwe={0} code="ARS" contraparte="Marina" />);
    expect(r.getByText('common.settled')).toBeTruthy();
    expect(r.queryByTestId('saldo-neto-desglose')).toBeNull();
  });

  it('con ids, los tres montos ruedan (MontoRodante) con su minor', () => {
    const ids = { neto: 'x.neto', owedToYou: 'x.owed', youOwe: 'x.owe' };
    const r = render(<SaldoNeto owedToYou={9_000} youOwe={2_000} code="ARS" ids={ids} />);
    expect(r.UNSAFE_getByProps({ id: 'x.neto' }).props.minor).toBe(7_000);
    expect(r.UNSAFE_getByProps({ id: 'x.owed' }).props.minor).toBe(9_000);
    expect(r.UNSAFE_getByProps({ id: 'x.owe' }).props.minor).toBe(2_000);
  });

  it('pending (Amigos convirtiendo monedas): los tres montos esperan con su placeholder', () => {
    const ids = { neto: 'f.neto', owedToYou: 'f.owed', youOwe: 'f.owe' };
    const r = render(<SaldoNeto owedToYou={9_000} youOwe={2_000} code="ARS" ids={ids} pending pendingLabel="calculando" />);
    for (const id of Object.values(ids)) {
      expect(r.UNSAFE_getByProps({ id }).props).toMatchObject({ pending: true, pendingAccessibilityLabel: 'calculando' });
    }
  });

  describe('en los dos skins', () => {
    afterEach(() => { useSettingsStore.setState({ skin: 'default' }); });

    it('Aero: va en su propia tarjeta (panel del skin)', () => {
      useSettingsStore.setState({ skin: 'aero' });
      const r = render(<SaldoNeto owedToYou={9_000} youOwe={2_000} code="ARS" />);
      expect(r.getByTestId('skin-panel')).toBeTruthy();
      expect(r.getByTestId('saldo-neto-desglose')).toBeTruthy();
    });

    it('Clásico: banda sin panel, mismo contenido', () => {
      useSettingsStore.setState({ skin: 'default' });
      const r = render(<SaldoNeto owedToYou={9_000} youOwe={2_000} code="ARS" />);
      expect(r.queryByTestId('skin-panel')).toBeNull();
      expect(r.getByTestId('saldo-neto-desglose')).toBeTruthy();
    });
  });
});
