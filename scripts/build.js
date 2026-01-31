/**
 * 跨平台构建入口（避免 PowerShell 不支持 `&&` 的问题）
 *
 * 顺序执行：
 * - types (root)
 * - js (cjs, root)
 * - js (esm, root)
 * - types (react)
 * - js (cjs, react)
 * - js (esm, react)
 * - clean
 *
 * 注意：
 * - Windows 下直接 spawn `npm.cmd` 在某些环境会出现 EINVAL；
 *   这里优先使用 npm 注入的 `npm_execpath`（npm-cli.js）来调用 npm。
 */
const { spawnSync } = require('child_process');

/**
 * Run a command and inherit stdio.
 */
function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: false
  });

  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
}

/**
 * Run npm via node + npm-cli.js when available.
 * This is more reliable across Windows shells/environments.
 */
function runNpm(npmArgs) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    run(process.execPath, [npmExecPath, ...npmArgs]);
    return;
  }

  /** Fallback: try calling npm directly */
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  run(npmCmd, npmArgs);
}

runNpm(['run', 'build:preclean']);
runNpm(['run', 'build:types']);
runNpm(['run', 'build:js']);
runNpm(['run', 'build:js:esm']);
runNpm(['run', 'build-react:types']);
runNpm(['run', 'build-react:js']);
runNpm(['run', 'build-react:js:esm']);
runNpm(['run', 'build:clean']);

