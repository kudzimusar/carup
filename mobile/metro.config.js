const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const config = withNativeWind(getDefaultConfig(__dirname), { input: './global.css' });
const sharedRoot = path.resolve(__dirname, '../shared');
const nativeWindResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const request = moduleName === '@shared'
    ? sharedRoot
    : moduleName.startsWith('@shared/')
      ? path.join(sharedRoot, moduleName.slice('@shared/'.length))
      : moduleName;

  if (nativeWindResolveRequest) {
    return nativeWindResolveRequest(context, request, platform);
  }
  return context.resolveRequest(context, request, platform);
};

module.exports = config;
