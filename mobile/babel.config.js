module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // NativeWind CSS-in-JS support
      'nativewind/babel',
    ],
  };
};
