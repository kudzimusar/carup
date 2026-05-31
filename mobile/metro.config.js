const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// 1. Locate the workspace roots
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// 2. Watch the shared directory
config.watchFolders = [workspaceRoot];

// 3. Force Metro to resolve nested workspaces node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 4. Force NativeWind tailwind integrations
config.resolver.sourceExts.push('mjs');

module.exports = config;
