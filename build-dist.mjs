import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(root, 'dist');

function splitLargeFlac(dirRel) {
  const flacPath = path.join(root, dirRel, 'record.flac');
  const part0Path = path.join(root, dirRel, 'record.flac.part0');
  const part1Path = path.join(root, dirRel, 'record.flac.part1');
  if (fs.existsSync(part0Path) && fs.existsSync(part1Path)) return;
  if (!fs.existsSync(flacPath)) return;
  const buf = fs.readFileSync(flacPath);
  const mid = Math.ceil(buf.byteLength / 2);
  fs.writeFileSync(part0Path, buf.subarray(0, mid));
  fs.writeFileSync(part1Path, buf.subarray(mid));
  console.log(`Split ${dirRel}/record.flac (${buf.byteLength} bytes) into 2 parts`);
}

function copyTree(src, dst, filterFn = () => true) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sPath = path.join(src, entry.name);
    const dPath = path.join(dst, entry.name);
    if (!filterFn(sPath, entry)) continue;
    const stat = fs.statSync(sPath);
    if (stat.isDirectory()) {
      copyTree(sPath, dPath, filterFn);
    } else if (stat.isFile()) {
      fs.copyFileSync(sPath, dPath);
    }
  }
}

splitLargeFlac('assets/rhapsody');
splitLargeFlac('assets/summer-air');

fs.mkdirSync(distDir, { recursive: true });
for (const entry of fs.readdirSync(distDir)) {
  fs.rmSync(path.join(distDir, entry), { recursive: true, force: true });
}

fs.copyFileSync(path.join(root, 'index.html'), path.join(distDir, 'index.html'));
fs.copyFileSync(path.join(root, 'favicon.svg'), path.join(distDir, 'favicon.svg'));
copyTree(path.join(root, 'src'), path.join(distDir, 'src'));
copyTree(path.join(root, '67js'), path.join(distDir, '67js'));
copyTree(path.join(root, 'records'), path.join(distDir, 'records'));
copyTree(path.join(root, 'assets'), path.join(distDir, 'assets'), (sPath) => {
  const norm = sPath.replace(/\\/g, '/');
  if (norm.endsWith('/assets/rhapsody/record.flac') || norm.endsWith('/assets/summer-air/record.flac')) {
    return false;
  }
  return true;
});

console.log('Built static bundle in dist/');
