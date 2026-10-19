const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const config = getDefaultConfig(__dirname);
const sharedRoot = path.resolve(__dirname, '../shared');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@shared' || moduleName.startsWith('@shared/')) {
    const suffix = moduleName === '@shared' ? '' : moduleName.slice('@shared/'.length);
    return context.resolveRequest(context, path.join(sharedRoot, suffix), platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
