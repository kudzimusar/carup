const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const config = withNativeWind(getDefaultConfig(__dirname), { input: './global.css' });
const workspaceRoot = path.resolve(__dirname, '..');
const sharedRoot = path.join(workspaceRoot, 'shared');

// The shared source tree is not an npm workspace package; keep it visible to Metro
// without restoring the obsolete nodeModulesPaths/disableHierarchicalLookup overrides.
config.watchFolders = [...new Set([...(config.watchFolders || []), workspaceRoot])];

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
