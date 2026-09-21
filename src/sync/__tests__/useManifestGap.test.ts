import { renderHook, waitFor } from '@testing-library/react-native';
import { recordManifestCheck, clearManifestGaps } from '../manifestHealth';
import { useManifestGap } from '../useManifestGap';

describe('useManifestGap', () => {
  beforeEach(() => clearManifestGaps());

  it('false cuando no hay gap', () => {
    const { result } = renderHook(() => useManifestGap('G'));
    expect(result.current).toBe(false);
  });

  it('true cuando se registró un gap para ese grupo', async () => {
    recordManifestCheck('G', ['ck1']);
    const { result } = renderHook(() => useManifestGap('G'));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('no reacciona a gaps de otro grupo', () => {
    recordManifestCheck('OTRO', ['ck1']);
    const { result } = renderHook(() => useManifestGap('G'));
    expect(result.current).toBe(false);
  });
});
