module.exports = function (api) {
  api.cache(true);
  return {
    // Disable preset-bundled worklets/reanimated so the plugin runs once as the last step.
    presets: [['babel-preset-expo', { reanimated: false, worklets: false }]],
    plugins: ['react-native-worklets/plugin'],
  };
};
