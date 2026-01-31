/**
 * 构建前清理输出目录，避免 tsc TS5055（输出覆盖输入）问题
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dirsToRemove = [
  'library',
  'esm',
  'react/library',
  'react/esm'
];

/**
 * Delete accidental declaration artifacts under src/ (if any).
 * These files should be emitted into library/ instead.
 */
function deleteDtsUnderSrc() {
  const srcRoot = path.join(root, 'src');
  if (!fs.existsSync(srcRoot)) return;

  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      if (ent.isFile()) {
        if (full.endsWith('.d.ts') || full.endsWith('.d.ts.map')) {
          try {
            fs.rmSync(full, { force: true });
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('Preclean warning:', e && e.message ? e.message : e);
          }
        }
      }
    }
  };

  walk(srcRoot);
}

deleteDtsUnderSrc();

for (const dir of dirsToRemove) {
  const fullPath = path.join(root, dir);
  try {
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      // eslint-disable-next-line no-console
      console.log('Removed:', dir);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('Preclean warning:', e && e.message ? e.message : e);
  }
}

