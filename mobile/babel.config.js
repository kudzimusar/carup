module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // NativeWind — must come before Reanimated
      'nativewind/babel',
      // React Native Reanimated — must come before worklets
      'react-native-reanimated/plugin',
      // React Native Worklets — must be LAST
      'react-native-worklets/plugin',
    ],
  };
};
