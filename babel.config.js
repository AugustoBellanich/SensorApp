module.exports = function(api) {
  api.cache(true);

  // Lista de plugins. Aquí agregaremos más si en el futuro usas Reanimated, etc.
  const plugins = [];

  // LÓGICA DE LIMPIEZA:
  // Si se está generando el APK para producción (Release), activa el borrado de logs.
  if (process.env.NODE_ENV === 'production' || process.env.BABEL_ENV === 'production') {
    plugins.push(['transform-remove-console', { exclude: ['error', 'warn'] }]);
  }

  return {
    presets: ['babel-preset-expo'],
    plugins: plugins,
  };
};