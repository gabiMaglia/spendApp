import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

import { SyncNoDisponible } from '@/src/components/SyncNoDisponible';

describe('SyncNoDisponible (T-099)', () => {
  it('sin buzón configurado, avisa', () => {
    const { getByText } = render(<SyncNoDisponible configurado={false} />);
    expect(getByText('profile.sync_unavailable')).toBeTruthy();
    expect(getByText('profile.sync_unavailable_sub')).toBeTruthy();
  });

  it('con buzón configurado, no dibuja nada', () => {
    const { queryByText } = render(<SyncNoDisponible configurado />);
    expect(queryByText('profile.sync_unavailable')).toBeNull();
  });
});
