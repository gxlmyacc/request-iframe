/**
 * 构建后清理：从 library 输出目录中移除 __tests__ 及 .test.* 相关文件
 * 因 Babel --copy-files 会复制被 .babelignore 忽略的文件，需在构建后显式删除
 */
const fs = require('fs');
const path = require('path');

const dirsToClean = [
  'library/__tests__',
  'esm/__tests__',
  'react/library/__tests__',
  'react/esm/__tests__'
];
const root = path.resolve(__dirname, '..');

dirsToClean.forEach((dir) => {
  const fullPath = path.join(root, dir);
  try {
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true });
      console.log('Removed:', dir);
    }
  } catch (e) {
    console.warn('Clean warning:', e.message);
  }
});
