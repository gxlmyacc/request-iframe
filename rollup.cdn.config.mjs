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
        sourcemap: true
      },
      {
        file: 'cdn/request-iframe.umd.min.js',
        format: 'umd',
        name: 'RequestIframe',
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

