module.exports = {
  presets: [
    [
      '@babel/preset-env',
      {
        /** 浏览器目标从根目录的 browserslist 读取 */
        useBuiltIns: 'usage',
        corejs: 3,
        /** 转换为 CommonJS 模块格式 */
        modules: 'commonjs'
      }
    ],
    [
      '@babel/preset-typescript',
      {
        /** react 包可能包含 tsx，开启 TSX 解析更稳妥 */
        isTSX: true,
        allExtensions: true
      }
    ]
  ],
  plugins: [
    [
      '@babel/plugin-transform-runtime',
      {
        corejs: false,
        helpers: true,
        regenerator: true,
        useESModules: false
      }
    ]
  ]
};

