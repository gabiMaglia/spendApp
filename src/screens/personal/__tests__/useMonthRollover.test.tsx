import { renderHook, act } from '@testing-library/react-native';
import { useMonthRollover } from '@/src/screens/personal/hooks/useMonthRollover';
import { usePersonalStore, currentMonthKey } from '@/src/store/personalStore';
import type { FxCache } from '@/src/services/fx';
import type { PersonalEntry } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

let mockCache: FxCache | null = null;
let mockEnsure: jest.Mock;
jest.mock('@/src/services/fx', () => ({
  ...jest.requireActual('@/src/services/fx'),
  readCache: () => mockCache,
  ensureRates: (...a: unknown[]) => mockEnsure(...a),
}));

const fx: FxCache = { base: 'USD', rates: { USD: 1, ARS: 1000 }, fetchedAt: 1, nextUpdateAt: 0 };
const ahora = new Date();
const mesPrev = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 15, 12).getTime();
const prevKey = (() => { const d = new Date(mesPrev); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();

const gastoUsd = {
  id: 'u1', kind: 'expense', description: 'x', amount: 100, currency: 'USD', category: 'other',
  date: mesPrev, createdAt: mesPrev, updatedAt: mesPrev, isDeleted: false,
} as PersonalEntry;

const carryovers = () => usePersonalStore.getState().entries.filter(x => x.kind === 'carryover');

beforeEach(() => {
  mockCache = null;
  mockEnsure = jest.fn(() => Promise.resolve(null));
  usePersonalStore.setState({
    entries: [gastoUsd],
    budget: { currency: 'ARS', monthlyAmount: 500_000, includeOwedToMe: false },
    lastSeenMonth: prevKey,
  });
});

describe('useMonthRollover multimoneda (T-256)', () => {
  it('sin cotizaciones pospone: no crea carryover ni avanza lastSeenMonth', async () => {
    renderHook(() => useMonthRollover(prevKey, 0, [gastoUsd]));
    await act(async () => {});
    expect(carryovers()).toHaveLength(0);
    expect(usePersonalStore.getState().lastSeenMonth).toBe(prevKey);
  });

  it('cuando llegan las cotizaciones arrastra una sola vez', async () => {
    mockEnsure = jest.fn(() => Promise.resolve(fx));
    const { rerender } = renderHook(() => useMonthRollover(prevKey, 0, [gastoUsd]));
    await act(async () => {});
    expect(carryovers()).toHaveLength(1);
    // 1,00 USD = 1000,00 ARS = 100.000 centavos; 500.000 - 100.000
    expect(carryovers()[0]).toMatchObject({ amount: 400_000, currency: 'ARS', isPositiveCarryover: true });
    expect(usePersonalStore.getState().lastSeenMonth).toBe(currentMonthKey());
    rerender({});
    await act(async () => {});
    expect(carryovers()).toHaveLength(1);
  });

  it('con cotizaciones ya en cache arrastra sin ir a la red', async () => {
    mockCache = fx;
    renderHook(() => useMonthRollover(prevKey, 0, [gastoUsd]));
    await act(async () => {});
    expect(carryovers()).toHaveLength(1);
    expect(mockEnsure).not.toHaveBeenCalled();
  });
});
