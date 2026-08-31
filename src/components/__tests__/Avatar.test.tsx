import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { Avatar, AvatarStack } from '../Avatar';

describe('Avatar', () => {
  it('renders initials from a full name', () => {
    render(<Avatar name="Ana López" />);
    expect(screen.getByText('AL')).toBeTruthy();
  });

  it('renders a single initial for a one-word name', () => {
    render(<Avatar name="Bob" />);
    expect(screen.getByText('B')).toBeTruthy();
  });

  it('renders ? when name is empty', () => {
    render(<Avatar name="" />);
    expect(screen.getByText('?')).toBeTruthy();
  });

  it('uses only the first two words for initials', () => {
    render(<Avatar name="Ana María López" />);
    expect(screen.getByText('AM')).toBeTruthy();
  });
});

describe('AvatarStack', () => {
  it('shows overflow count when people exceed max', () => {
    const people = [
      { name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }, { name: 'E' },
    ];
    render(<AvatarStack people={people} max={4} />);
    expect(screen.getByText('+1')).toBeTruthy();
  });

  it('does not show overflow when people count is within max', () => {
    const people = [{ name: 'A' }, { name: 'B' }];
    render(<AvatarStack people={people} max={4} />);
    expect(screen.queryByText(/^\+/)).toBeNull();
  });

  it('renders nothing when people array is empty', () => {
    const { toJSON } = render(<AvatarStack people={[]} />);
    // A View is rendered but no text inside
    expect(screen.queryByText(/./)).toBeNull();
  });
});

describe('la foto llega hasta la pila (bug del PO, 31/08)', () => {
  // La pila dibujaba SIEMPRE iniciales porque su tipo no tenía `photo`: quien
  // llamaba armaba `{name, hue}` a mano y la foto se perdía en el camino, sin
  // que nada fallara. Por eso en Contactos se veía la foto nueva y en Grupos
  // seguían las iniciales.
  it('con foto NO dibuja las iniciales', () => {
    render(<AvatarStack people={[{ name: 'Ana López', photo: 'data:image/jpeg;base64,AAAA' }]} />);
    expect(screen.queryByText('AL')).toBeNull();
  });

  it('sin foto sigue dibujando las iniciales', () => {
    render(<AvatarStack people={[{ name: 'Ana López' }]} />);
    expect(screen.getByText('AL')).toBeTruthy();
  });

  it('mezcla: cada uno con lo suyo', () => {
    render(<AvatarStack people={[
      { name: 'Ana López', photo: 'data:image/jpeg;base64,AAAA' },
      { name: 'Bob Ruiz' },
    ]} />);
    expect(screen.queryByText('AL')).toBeNull();
    expect(screen.getByText('BR')).toBeTruthy();
  });
});
