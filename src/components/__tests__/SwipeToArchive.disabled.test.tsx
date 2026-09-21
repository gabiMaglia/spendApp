import React from 'react';
import { render } from '@testing-library/react-native';
import { SwipeToArchive } from '../SwipeToArchive';
import { Text } from 'react-native';

describe('SwipeToArchive con disabled', () => {
  it('sin disabled, el gesto de swipe está habilitado', () => {
    const r = render(
      <SwipeToArchive archived onAction={() => {}}>
        <Text>fila</Text>
      </SwipeToArchive>,
    );
    const swipeable = r.UNSAFE_root.findByProps({ testID: undefined, friction: 2 });
    expect(swipeable.props.enabled).not.toBe(false);
  });

  it('con disabled, el Swipeable queda deshabilitado', () => {
    const r = render(
      <SwipeToArchive archived disabled onAction={() => {}}>
        <Text>fila</Text>
      </SwipeToArchive>,
    );
    const swipeable = r.UNSAFE_root.findByProps({ friction: 2 });
    expect(swipeable.props.enabled).toBe(false);
  });
});
