import { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { PlatformPressable } from '@react-navigation/elements';

import { hapticSeleccionar } from '@/src/utils/haptics';

export function HapticTab(props: BottomTabBarButtonProps) {
  return (
    <PlatformPressable
      {...props}
      onPressIn={(ev) => {
        // Cambiar de pestaña es elegir: el tic de selección, sólo en iOS como antes.
        if (process.env.EXPO_OS === 'ios') hapticSeleccionar();
        props.onPressIn?.(ev);
      }}
    />
  );
}
