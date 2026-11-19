import { defineConfig, mergeConfig } from 'vite';
import studioConfig from './vite.config';

const backend = process.env.OPENMOTION_STUDIO_BACKEND;
if (!backend) throw new Error('Set OPENMOTION_STUDIO_BACKEND to the previewUrl printed by npm start.');

const target = new URL(backend);
if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)
  || !target.port || target.pathname !== '/' || target.username || target.password || target.search || target.hash) {
  throw new Error('OPENMOTION_STUDIO_BACKEND must be an HTTP loopback origin with a port.');
}

// Preserve the browser Host so Studio can check it against Origin on writes.
const backendProxy = { target: target.origin, changeOrigin: false };

export default mergeConfig(studioConfig, defineConfig({
  server: {
    host: '127.0.0.1',
    proxy: {
      '^/(?:api|motion-api|design-api)/': backendProxy,
      '^/__hyperframes_config$': backendProxy,
      '^/connect/guide$': backendProxy,
      '/guide-assets/': backendProxy,
      '/web/catalog/': backendProxy,
    },
  },
}));
