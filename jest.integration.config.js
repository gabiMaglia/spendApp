// Suite de integración contra Supabase LOCAL (T-147). Nunca corre en `npm test`:
// necesita `scripts/supabase-int.sh <etapa>` antes, y la suite normal ya se colgó
// una vez 44 min por tocar red (relay.ts). Correr con `npm run test:int`.
//
// `babel-preset-expo` no está en la raíz de node_modules: vive anidado bajo
// `expo`, así que se resuelve desde ahí (el mismo que usa jest-expo).
const presetExpo = require.resolve('babel-preset-expo', { paths: [require.resolve('expo/package.json')] });

module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/__tests__/integration/**/*.int.test.ts'],
  transform: { '^.+\\.[jt]sx?$': ['babel-jest', { presets: [presetExpo] }] },
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
  testTimeout: 60_000,
  // supabase-js deja timers de auth/realtime vivos aunque se desconecte; sin
  // esto Jest no sale solo al terminar. Sólo aplica a esta suite.
  forceExit: true,
};
