import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';

const sharedPlugins = [
  resolve({
    browser: true,
    preferBuiltins: false
  }),
  commonjs()
];

/**
 * CDN bundles:
 * - Core: built from `esm/index.js` -> `cdn/`
 * - React: built from `react/esm/index.js` -> `cdn/`
 */
export default [
  /** Core UMD bundle (standalone) */
  {
    input: './esm/index.js',
    plugins: sharedPlugins,
    output: [
      {
        file: 'cdn/request-iframe.umd.js',
        format: 'umd',
        name: 'RequestIframe',
        /**
         * UMD/IIFE does NOT support code-splitting.
         * Since our ESM build includes dynamic import() (e.g. debug lazy-loading),
         * force Rollup to inline dynamic imports to keep this bundle as a single file.
         */
        inlineDynamicImports: true,
        sourcemap: true
      },
      {
        file: 'cdn/request-iframe.umd.min.js',
        format: 'umd',
        name: 'RequestIframe',
        inlineDynamicImports: true,
        sourcemap: true,
        plugins: [terser()]
      }
    ]
  },

  /** React UMD bundle (external: react + request-iframe core) */
  {
    input: './react/esm/index.js',
    plugins: sharedPlugins,
    external: ['react', 'request-iframe'],
    output: [
      {
        file: 'cdn/request-iframe-react.umd.js',
        format: 'umd',
        name: 'RequestIframeReact',
        inlineDynamicImports: true,
        globals: {
          react: 'React',
          'request-iframe': 'RequestIframe'
        },
        sourcemap: true
      },
      {
        file: 'cdn/request-iframe-react.umd.min.js',
        format: 'umd',
        name: 'RequestIframeReact',
        inlineDynamicImports: true,
        globals: {
          react: 'React',
          'request-iframe': 'RequestIframe'
        },
        sourcemap: true,
        plugins: [terser()]
      }
    ]
  }
];

