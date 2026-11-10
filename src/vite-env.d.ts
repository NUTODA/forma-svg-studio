/// <reference types="vite/client" />

declare module 'virtual:forma-assets' {
  const manifest: import('./domain/types').AssetManifest;
  export default manifest;
}
