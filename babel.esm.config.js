module.exports = {
  presets: [
    [
      '@babel/preset-env',
      {
        /** 目标浏览器从 .browserslistrc 或 package.json 的 browserslist 字段自动读取（Chrome 49） */
        /** 使用 core-js 进行 polyfill */
        useBuiltIns: 'usage',
        corejs: 3,
        /** 保持 ES Module 语法，输出 ESM */
        modules: false
      }
    ],
    [
      '@babel/preset-typescript',
      {
        /** 保留装饰器语法（如果使用） */
        isTSX: false,
        allExtensions: false
      }
    ]
  ],
  plugins: [
    /** 使用 runtime 转换，避免重复引入 helper 函数（ESM 版本） */
    [
      '@babel/plugin-transform-runtime',
      {
        corejs: false,
        helpers: true,
        regenerator: true,
        useESModules: true
      }
    ]
  ]
};

