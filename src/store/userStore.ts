import { create } from 'zustand';
import type { User } from '@/src/types/models';
import MOCK_USERS from '@/src/mocks/users.json';

interface UserStoreState {
  users: User[];
  getUserById: (id: string) => User | undefined;
  getUserName: (id: string) => string;
}

export const useUserStore = create<UserStoreState>(() => ({
  users: MOCK_USERS as User[],

  getUserById: (id) => (MOCK_USERS as User[]).find(u => u.id === id),

  getUserName: (id) => (MOCK_USERS as User[]).find(u => u.id === id)?.name ?? id,
}));
