import React from 'react';
import { Text } from 'react-native';
import { render, renderHook, screen } from '@testing-library/react-native';
import { Panel } from '@/src/components/skin/Panel';
import { MarmolPill } from '@/src/components/skin/MarmolPill';
import { GlowMeter } from '@/src/components/skin/GlowMeter';
import { useFabSkinStyle } from '@/src/components/skin/useFabSkinStyle';
import { useSettingsStore } from '@/src/store/settingsStore';

/** Estructura y comportamiento, nunca estilos (regla del proyecto). */
describe('superficies de skin', () => {
  beforeEach(() => useSettingsStore.setState({ skin: 'default', reduceAnimations: false }));

  describe('con el skin default (respaldo)', () => {
    it('Panel no agrega envoltorio: solo los hijos', () => {
      render(<Panel><Text>hijo</Text></Panel>);
      expect(screen.getByText('hijo')).toBeTruthy();
      expect(screen.queryByTestId('skin-panel')).toBeNull();
    });

    it('MarmolPill dibuja el mármol con el testID de quien llama, como hoy', () => {
      render(<MarmolPill testID="month-nav"><Text>marzo</Text></MarmolPill>);
      expect(screen.getByTestId('month-nav')).toBeTruthy();
      // `fondo-marmol` sale del árbol de accesibilidad (`accessibilityElementsHidden`
      // + `importantForAccessibility="no-hide-descendants"`, ver `FondoMarmol`), y
      // desde RNTL v13 las queries por defecto excluyen los elementos ocultos —
      // mismo `includeHiddenElements` que ya usa `CollapsibleHeader.test.tsx` para
      // este mismo testID.
      expect(screen.getByTestId('fondo-marmol', { includeHiddenElements: true })).toBeTruthy();
      expect(screen.queryByTestId('marmol-veil')).toBeNull();
    });

    it('GlowMeter usa la barra plana de siempre', () => {
      render(<GlowMeter pct={0.5} color="#3A4A5E" />);
      expect(screen.queryByTestId('glow-meter')).toBeNull();
    });

    it('useFabSkinStyle no agrega estilo', () => {
      const { result } = renderHook(() => useFabSkinStyle('primary'));
      expect(result.current).toBeUndefined();
    });
  });

  describe('con aero', () => {
    beforeEach(() => useSettingsStore.setState({ skin: 'aero' }));

    it('Panel envuelve a los hijos', () => {
      render(<Panel><Text>hijo</Text></Panel>);
      expect(screen.getByTestId('skin-panel')).toBeTruthy();
      expect(screen.getByText('hijo')).toBeTruthy();
    });

    it('MarmolPill conserva el testID, el mármol y suma el velo', () => {
      render(<MarmolPill testID="month-nav"><Text>marzo</Text></MarmolPill>);
      expect(screen.getByTestId('month-nav')).toBeTruthy();
      expect(screen.getByTestId('fondo-marmol', { includeHiddenElements: true })).toBeTruthy();
      expect(screen.getByTestId('marmol-veil')).toBeTruthy();
      expect(screen.getByText('marzo')).toBeTruthy();
    });

    it('GlowMeter dibuja su propia barra', () => {
      render(<GlowMeter pct={0.5} color="#3A4A5E" />);
      expect(screen.getByTestId('glow-meter')).toBeTruthy();
    });

    it('GlowMeter tolera pct fuera de rango', () => {
      // `screen` global sólo apunta al último `render()`: para verificar los DOS
      // casos sin que uno tape al otro, se compara cada resultado por separado.
      const alto = render(<GlowMeter pct={3} color="#3A4A5E" />);
      expect(alto.getByTestId('glow-meter')).toBeTruthy();
      const bajo = render(<GlowMeter pct={-1} color="#3A4A5E" />);
      expect(bajo.getByTestId('glow-meter')).toBeTruthy();
    });

    it('useFabSkinStyle devuelve un estilo para los dos FAB', () => {
      expect(renderHook(() => useFabSkinStyle('primary')).result.current).toBeDefined();
      expect(renderHook(() => useFabSkinStyle('secondary')).result.current).toBeDefined();
    });
  });
});
