import { create } from 'zustand';
import { createStorage } from '@/src/utils/createStorage';

const storage = createStorage('tier');

const FREE_DAILY_FREE_EXPENSES = 4;

function todayKey(userId: string): string {
  const today = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD' UTC
  return `expense_count_${userId}_${today}`;
}

interface TierState {
  getDailyCount: (userId: string) => number;
  requiresRewardedAd: (userId: string, isPro: boolean) => boolean;
  incrementCount: (userId: string) => void;
}

export const useTierStore = create<TierState>(() => ({
  getDailyCount: (userId) => {
    const raw = storage.getString(todayKey(userId));
    return raw ? parseInt(raw, 10) : 0;
  },

  requiresRewardedAd: (userId, isPro) => {
    if (isPro) return false;
    const raw = storage.getString(todayKey(userId));
    const count = raw ? parseInt(raw, 10) : 0;
    return count >= FREE_DAILY_FREE_EXPENSES;
  },

  incrementCount: (userId) => {
    const key = todayKey(userId);
    const current = storage.getString(key);
    const count = current ? parseInt(current, 10) : 0;
    storage.set(key, String(count + 1));
  },
}));
