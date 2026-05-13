import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const watch = process.argv.includes('--watch');
const root = path.dirname(fileURLToPath(import.meta.url));
const fromRoot = (relativePath) => path.join(root, relativePath).replaceAll('\\', '/');

const sharedOptions = {
  bundle: true,
  sourcemap: watch,
  minify: !watch,
  logLevel: 'info',
  legalComments: 'none',
  absWorkingDir: root
};

watch
  ? await build({
    ...sharedOptions,
    entryPoints: [fromRoot('src/extension.ts')],
    outfile: fromRoot('dist/extension.js'),
    platform: 'node',
    format: 'cjs',
    external: ['vscode'],
    watch: {
      onRebuild(error) {
        if (error) {
          console.error('[extension] rebuild failed', error);
          return;
        }

        console.log('[extension] rebuild complete');
      }
    }
  })
  : await build({
    ...sharedOptions,
    entryPoints: [fromRoot('src/extension.ts')],
    outfile: fromRoot('dist/extension.js'),
    platform: 'node',
    format: 'cjs',
    external: ['vscode']
  });

watch
  ? await build({
    ...sharedOptions,
    entryPoints: [fromRoot('webview/src/index.tsx')],
    outdir: fromRoot('dist/webview'),
    platform: 'browser',
    format: 'esm',
    loader: {
      '.css': 'css',
      '.ttf': 'dataurl',
      '.woff': 'dataurl',
      '.woff2': 'dataurl'
    },
    watch: {
      onRebuild(error) {
        if (error) {
          console.error('[webview] rebuild failed', error);
          return;
        }

        console.log('[webview] rebuild complete');
      }
    }
  })
  : await build({
    ...sharedOptions,
    entryPoints: [fromRoot('webview/src/index.tsx')],
    outdir: fromRoot('dist/webview'),
    platform: 'browser',
    format: 'esm',
    loader: {
      '.css': 'css',
      '.ttf': 'dataurl',
      '.woff': 'dataurl',
      '.woff2': 'dataurl'
    }
  });

if (watch) {
  console.log('Watching extension and webview bundles...');
}
