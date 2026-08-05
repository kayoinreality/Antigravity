const { getDefaultConfig } = require('expo/metro-config')
const path = require('node:path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

/**
 * Monorepo wiring.
 *
 * The shared packages are consumed as TypeScript source, so Metro has to watch
 * the whole workspace and know about both node_modules trees.
 *
 * Hierarchical lookup stays ON. The usual monorepo advice is to disable it so a
 * nested tree cannot supply a second copy of React, but that also stops Metro
 * finding legitimately nested dependencies — react-native-reanimated needs
 * semver@7 while something else hoisted semver@6 to the root, and with lookup
 * disabled the bundle fails outright. React is pinned to one exact version
 * across both apps, so the duplicate-React problem this would guard against
 * cannot arise here.
 */
config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

/**
 * Resolve the workspace packages to their real source paths rather than through
 * the symlinks npm places in node_modules.
 *
 * This is not cosmetic. canvas-engine is full of functions carrying the
 * 'worklet' directive, and they only become UI-thread functions if the worklets
 * Babel plugin transforms them. A file reached through node_modules can take a
 * different transform path, and the failure mode is nasty: everything compiles,
 * the app runs, and the gestures silently fall back to the JS thread. Pointing
 * at the source directly keeps them inside the project's Babel config.
 */
config.resolver.extraNodeModules = {
  '@antigravity/core': path.resolve(workspaceRoot, 'packages/core/src'),
  '@antigravity/canvas-engine': path.resolve(workspaceRoot, 'packages/canvas-engine/src'),
  '@antigravity/supabase-client': path.resolve(workspaceRoot, 'packages/supabase-client/src'),
}

module.exports = config
