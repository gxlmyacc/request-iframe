/**
 * @request-iframe/react 构建脚本（独立包）
 *
 * 顺序执行：
 * - types
 * - js (cjs)
 * - js (esm)
 */
const { spawnSync } = require('child_process');
const path = require('path');

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: false,
    cwd
  });
  if (result.error) throw result.error;
  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const reactRoot = path.resolve(__dirname, '..');

run(npmCmd, ['run', 'build:types'], reactRoot);
run(npmCmd, ['run', 'build:js'], reactRoot);
run(npmCmd, ['run', 'build:js:esm'], reactRoot);

