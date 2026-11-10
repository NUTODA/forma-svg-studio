// CONTRACT STUB — owned by the SVG core agent.
// Serves `virtual:forma-assets` (an AssetManifest built by scanning public/assets with the same
// pure-TS analysis code the browser uses), watches the folder in dev and reloads on changes.
import type { Plugin } from 'vite';

export function formaAssets(): Plugin {
  const id = 'virtual:forma-assets';
  const resolved = '\0' + id;
  return {
    name: 'forma-assets',
    resolveId(source) {
      return source === id ? resolved : null;
    },
    load(source) {
      if (source !== resolved) return null;
      return 'export default { files: [], ignored: [] };';
    },
  };
}
