import { useEffect, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';
import { useThemeStore } from '@/src/store/themeStore';

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web.
 * Tema efectivo: sigue la elección del usuario (Ajustes > Apariencia); en 'auto' cae al SO.
 */
export function useColorScheme() {
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const themeChoice = useThemeStore((s) => s.themeChoice);
  const systemScheme = useRNColorScheme();

  if (!hasHydrated) {
    return 'light';
  }

  if (themeChoice === 'auto') {
    return systemScheme;
  }
  return themeChoice;
}
