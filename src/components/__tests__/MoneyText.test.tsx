import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { MoneyText } from '../MoneyText';

describe('MoneyText', () => {
  it('formatea el monto entero (menor unidad) con símbolo', () => {
    // 150000 minor ARS → $1.500: los centavos en cero no se muestran (PO 2026-09-02).
    render(<MoneyText minor={150000} code="ARS" />);
    expect(screen.getByText('$1.500')).toBeTruthy();
  });

  it('CLP no tiene decimales: no muestra parte decimal', () => {
    render(<MoneyText minor={1500} code="CLP" />);
    // 1500 minor CLP (0 decimales) → $1.500
    expect(screen.getByText('$1.500')).toBeTruthy();
  });

  it('antepone el prefijo pegado al monto (ej. signo)', () => {
    render(<MoneyText minor={150000} code="ARS" prefix="+" />);
    expect(screen.getByText('+$1.500')).toBeTruthy();
  });

  it('nunca corta el número: fuerza una sola línea y achica la fuente', () => {
    render(<MoneyText minor={150000} code="ARS" />);
    const node = screen.getByText('$1.500');
    // Estas dos props son las que impiden el salto de línea entre dígitos/decimales
    // y el signo $ en pantallas angostas (achica en vez de cortar).
    expect(node.props.numberOfLines).toBe(1);
    expect(node.props.adjustsFontSizeToFit).toBe(true);
  });
});
