import { useRef, useState } from 'react';
import type { TextInput } from 'react-native';
import { v4 as uuidv4 } from 'uuid';
import { useUserStore } from '@/src/store/userStore';
import { hapticSuccess } from '@/src/utils/haptics';
import { syncedNow } from '@/src/utils/syncedClock';

/** Estado + acción de la hoja "Nuevo contacto" (alta manual, sin QR). */
export function useAddContactSheet() {
  const addOrUpdateUser = useUserStore(s => s.addOrUpdateUser);
  const [visible, setVisible] = useState(false);
  const [name, setName] = useState('');
  const inputRef = useRef<TextInput>(null);

  function close() {
    setVisible(false);
    setName('');
  }

  function confirm() {
    const clean = name.trim();
    if (!clean) return;
    hapticSuccess();
    addOrUpdateUser({
      id:           uuidv4(),
      name:         clean,
      email:        '',
      authProvider: 'google',
      updatedAt:    syncedNow(),
      isDeleted:    false,
      createdAt:    Date.now(),
    });
    close();
  }

  return { visible, open: () => setVisible(true), close, name, setName, inputRef, confirm };
}
