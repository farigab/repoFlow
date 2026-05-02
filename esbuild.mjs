import { build } from 'esbuild';

const watch = process.argv.includes('--watch');

const sharedOptions = {
  bundle: true,
  sourcemap: watch,
  minify: !watch,
  logLevel: 'info',
  legalComments: 'none'
};

watch
  ? await build({
    ...sharedOptions,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
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
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    external: ['vscode']
  });

watch
  ? await build({
    ...sharedOptions,
    entryPoints: ['webview/src/index.tsx'],
    outdir: 'dist/webview',
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
    entryPoints: ['webview/src/index.tsx'],
    outdir: 'dist/webview',
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
