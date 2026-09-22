import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

/** Public path the renderer asks for; see `segmentation/mediapipe.ts`. */
const PUBLIC_PREFIX = '/vendor/mediapipe/wasm/';

/**
 * The fileset `FilesetResolver.forVisionTasks` looks for. It probes for WASM
 * SIMD support and fetches only the matching pair, so both are published and
 * at most one is ever downloaded.
 */
const WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
] as const;

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
};

function resolveWasmFile(name: string): string {
  const require = createRequire(import.meta.url);
  return require.resolve(`@mediapipe/tasks-vision/${name}`);
}

/**
 * Publishes the MediaPipe WASM runtime from `node_modules` under the
 * renderer's own origin.
 *
 * MediaPipe's documented setup points `FilesetResolver` at a CDN. LiveScape is
 * local-first, so the runtime is served by whatever is serving the renderer
 * instead: segmentation then works with no internet connection, and the
 * renderer never talks to a third-party host.
 *
 * The files are copied at build time rather than committed, because they are
 * roughly 23 MB of generated dependency output that `npm ci` already fetches.
 */
export function mediapipeAssets(): Plugin {
  return {
    name: 'livescape:mediapipe-assets',

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0];
        if (!url || !url.startsWith(PUBLIC_PREFIX)) return next();

        const name = url.slice(PUBLIC_PREFIX.length);
        if (!WASM_FILES.includes(name as (typeof WASM_FILES)[number])) return next();

        void (async () => {
          try {
            const body = await readFile(resolveWasmFile(name));
            const extension = name.endsWith('.wasm') ? '.wasm' : '.js';
            res.setHeader('Content-Type', CONTENT_TYPES[extension] ?? 'application/octet-stream');
            res.end(body);
          } catch (error) {
            next(error);
          }
        })();
      });
    },

    async generateBundle() {
      for (const name of WASM_FILES) {
        this.emitFile({
          type: 'asset',
          fileName: `vendor/mediapipe/wasm/${name}`,
          source: await readFile(resolveWasmFile(name)),
        });
      }
    },
  };
}
