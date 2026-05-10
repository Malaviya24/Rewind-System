const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const exclusionList = require('metro-config/private/defaults/exclusionList').default;

const projectRoot = __dirname;
const escapedRoot = projectRoot.replace(/[/\\]+/g, '[/\\\\]');
const ignoredProjectDirs = [
  '.android-build-tools',
  '.gradle-user-home',
  'dist',
  path.join('android', 'build'),
  path.join('android', 'app', 'build'),
].map((dir) => dir.replace(/[/\\]+/g, '[/\\\\]'));

const config = getDefaultConfig(projectRoot);
const existingBlockList = config.resolver.blockList
  ? Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : [config.resolver.blockList]
  : [];

config.resolver.blockList = exclusionList([
  ...existingBlockList,
  ...ignoredProjectDirs.map((dir) => new RegExp(`${escapedRoot}[/\\\\]${dir}[/\\\\].*`)),
]);

module.exports = config;
