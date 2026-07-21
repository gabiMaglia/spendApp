import { useColorScheme as useRNColorScheme } from 'react-native';
import { useThemeStore } from '@/src/store/themeStore';

/**
 * Tema efectivo de la app: sigue la elección del usuario (Ajustes > Apariencia).
 * En 'auto' cae al esquema del sistema operativo. Reactivo a ambas fuentes.
 */
export function useColorScheme() {
  const themeChoice = useThemeStore((s) => s.themeChoice);
  const systemScheme = useRNColorScheme();

  if (themeChoice === 'auto') {
    return systemScheme;
  }
  return themeChoice;
}
