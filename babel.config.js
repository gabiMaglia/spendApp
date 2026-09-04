// Antes de este archivo, Metro/jest-expo resolvían el babel config INTERNO de
// Expo (`expo/internal/babel-preset`) por ausencia de babel.config.js — ver
// `node_modules/jest-expo/src/resolveBabelConfig.js`. Este archivo lo reemplaza
// explícitamente para poder sumar el plugin de decoradores legacy que exige
// WatermelonDB (`@field`/`@json`/`@date`, src/db/models/*). Mantiene
// `babel-preset-expo` como base para no romper Metro/jest existente.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // legacy:true — sintaxis de decoradores stage-1 que usa WatermelonDB.
      // Debe ir ANTES que cualquier plugin de class-properties (babel-preset-expo
      // ya incluye soporte de class properties compatible con legacy decorators).
      ['@babel/plugin-proposal-decorators', { legacy: true }],
    ],
  };
};
