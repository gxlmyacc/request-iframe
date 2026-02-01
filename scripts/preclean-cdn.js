/**
 * Preclean CDN build output directories.
 */
const fs = require('fs');
const path = require('path');

function rm(dir) {
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('CDN preclean warning:', e?.message || e);
  }
}

function mkdir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

const root = path.resolve(__dirname, '..');
const cdnDir = path.join(root, 'cdn');

rm(cdnDir);
mkdir(cdnDir);

// eslint-disable-next-line no-console
console.log('Prepared CDN output dir:', path.relative(root, cdnDir));

