// Serves `virtual:forma-assets` (an AssetManifest built by scanning public/assets with the same
// pure-TS analysis code the browser uses), watches the folder in dev and reloads on changes.
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { scanAssets } from './scanAssets.ts';

const VIRTUAL_ID = 'virtual:forma-assets';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

export function formaAssets(): Plugin {
  let config: ResolvedConfig | undefined;
  let assetsDir = '';

  const isAssetSvg = (file: string): boolean =>
    path.extname(file).toLowerCase() === '.svg' && path.resolve(path.dirname(file)) === assetsDir;

  return {
    name: 'forma-assets',
    configResolved(resolvedConfig) {
      config = resolvedConfig;
      // `publicDir` is `false` ('' after resolution) when disabled and is already absolute otherwise.
      const publicDir = resolvedConfig.publicDir || 'public';
      assetsDir = path.resolve(resolvedConfig.root, publicDir, 'assets');
    },
    resolveId(source) {
      return source === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(source) {
      if (source !== RESOLVED_ID) return null;
      // No addWatchFile(dir): in dev it becomes an unresolvable import of the directory.
      // The folder is watched by the dev server below.
      const manifest = scanAssets(assetsDir);
      for (const { file, reason } of manifest.ignored) {
        config?.logger.warnOnce(`[forma-assets] «${file}» пропущен: ${reason}`);
      }
      return `export default ${JSON.stringify(manifest)};`;
    },
    configureServer(server) {
      server.watcher.add(assetsDir);
      const onChange = (file: string): void => {
        if (!isAssetSvg(file)) return;
        const graph = server.environments.client.moduleGraph;
        const module = graph.getModuleById(RESOLVED_ID);
        if (module) graph.invalidateModule(module);
        server.hot.send({ type: 'full-reload' });
      };
      server.watcher.on('add', onChange);
      server.watcher.on('unlink', onChange);
      server.watcher.on('change', onChange);
    },
  };
}
