// Instancia de WatermelonDB (ADR-001). Este archivo lo importa SOLO el código
// de app (dev build) — NO los tests, que crean su propia DB con el adapter
// LokiJS en memoria (ver src/db/__tests__). Instanciar el SQLiteAdapter acá
// requiere el módulo nativo, así que en Node/jest no se importa.
import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { schema } from './schema';
import {
  UserModel, GroupModel, ExpenseModel, PaymentModel, PersonalEntryModel,
} from './models';

// ⚠️ CIFRADO EN REPOSO (S-01) — SPIKE PENDIENTE (ADR-001 §S-01):
// El adapter SQLite ESTÁNDAR de WatermelonDB NO cifra el archivo .db. Para
// cumplir S-01 hace falta una build de SQLCipher del adapter y pasarle la clave
// de `getOrCreateEncryptionKey()` (src/db/encryptionKey.ts) — típicamente vía
// `PRAGMA key`. Mientras eso no se resuelva, los datos en disco NO están
// cifrados: NO declarar cifrado real. La clave YA se gestiona (Keychain/
// Keystore); solo falta enchufarla al adapter cuando se elija la build SQLCipher.
const adapter = new SQLiteAdapter({
  schema,
  jsi: true, // New Architecture (app.json newArchEnabled) — adapter síncrono JSI.
  dbName: 'splitp2p',
  onSetUpError: (error) => {
    // eslint-disable-next-line no-console
    console.error('[db] WatermelonDB setup error:', error);
  },
});

export const database = new Database({
  adapter,
  modelClasses: [UserModel, GroupModel, ExpenseModel, PaymentModel, PersonalEntryModel],
});
