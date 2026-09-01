import fs from 'fs';
import path from 'path';
import React from 'react';
import { render } from '@testing-library/react-native';
import { TrustMark } from '../TrustMark';

/**
 * **La marca** (T-041 · S10). Una sola, dos causas — decisión 2 del PO.
 *
 * Es un componente atómico: recibe el texto YA traducido y dibuja. No sabe qué
 * veredicto lo produjo ni qué pantalla lo muestra, y por eso sirve igual en la
 * fila del grupo, en el feed de actividad y en el detalle del gasto.
 */
describe('TrustMark', () => {
  it('muestra el texto que le pasan', () => {
    const { getByText } = render(<TrustMark label="Sin verificar" />);
    expect(getByText('Sin verificar')).toBeTruthy();
  });

  /**
   * El copy es NEUTRO por decisión del PO, y la razón es de fondo: el borde de
   * ADR-004 (Apple manda `email` sólo en la primera autorización) hace que
   * registros LEGÍTIMOS no verifiquen. Un texto acusatorio acusaría a gente
   * honesta por una limitación nuestra.
   *
   * El componente no puede garantizar el copy —lo elige la pantalla— pero sí
   * puede garantizar que no lo inventa: renderiza lo que recibe y nada más.
   */
  it('no agrega texto propio: lo único que dice es lo que le pasaron', () => {
    const { getByTestId } = render(<TrustMark label="X" testID="marca" />);
    const textos: string[] = [];
    const recorrer = (nodo: any) => {
      if (typeof nodo === 'string') { textos.push(nodo); return; }
      React.Children.forEach(nodo?.props?.children, recorrer);
    };
    recorrer(getByTestId('marca'));
    expect(textos.join('')).toBe('X');
  });

  /**
   * Ley de construcción del proyecto: **un reusable no llama a `t()` adentro**.
   * Si lo hiciera, su test tendría que conocer las claves y el componente
   * dejaría de servir para el segundo caso (`ActionButton.tsx` lo deja escrito).
   * Se verifica sobre el fuente porque el mock de i18n de los tests devuelve la
   * clave y taparía el defecto.
   */
  it('no traduce por su cuenta', () => {
    const fuente = fs.readFileSync(
      path.resolve(__dirname, '../TrustMark.tsx'), 'utf8',
    );
    const imports = [...fuente.matchAll(/from '([^']+)'/g)].map(m => m[1]!);
    expect(imports.filter(i => /i18n/i.test(i))).toEqual([]);
    expect(fuente).not.toContain('useTranslation');
  });

  /** La variante vive ADENTRO del componente, nunca estilada por pantalla. */
  it('acepta la variante compacta sin cambiar lo que dice', () => {
    const { getByText } = render(<TrustMark label="Sin verificar" size="sm" />);
    expect(getByText('Sin verificar')).toBeTruthy();
  });

  /** Un lector de pantalla tiene que poder leerla: es un aviso, no un adorno. */
  it('se anuncia como aviso accesible', () => {
    const { getByTestId } = render(<TrustMark label="Sin verificar" testID="marca" />);
    expect(getByTestId('marca').props.accessibilityLabel).toBe('Sin verificar');
  });
});
