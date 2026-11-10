// Records a short silent clip of the groove view on the two disc machines into renders/demo/.
// Usage: node tools/record_groove.mjs [width] [height]
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.resolve(projectDirectory, '../../../67js/package.json'));
const { chromium } = require('playwright');

const width = Number(process.argv[2] || 1280);
const height = Number(process.argv[3] || 720);
const port = 4192;
const outputDirectory = path.join(projectDirectory, 'renders', 'demo');
const rawDirectory = path.join(outputDirectory, 'raw-groove');
mkdirSync(rawDirectory, { recursive: true });
for (const file of readdirSync(rawDirectory)) rmSync(path.join(rawDirectory, file));

const server = spawn('node', [path.join(projectDirectory, 'serve.mjs')], {
  env: { ...process.env, PORT: String(port) },
  stdio: 'ignore',
});
await new Promise((resolve) => setTimeout(resolve, 900));

const browser = await chromium.launch({
  headless: true,
  channel: 'chrome',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});

try {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    recordVideo: { dir: rawDirectory, size: { width, height } },
  });
  const page = await context.newPage();
  const videoStartedAt = Date.now();
  page.on('pageerror', (error) => console.log('pageerror', error.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  const state = () => page.evaluate(() => {
    const renderer = window.vinylDebug.renderer;
    return { shown: !!renderer.grooveViewShown, distance: renderer.cam.dist, preset: renderer.activePreset };
  });

  const cutStartsAt = Date.now();
  await page.click('#play-btn');
  await page.waitForTimeout(9000);
  await page.click('[data-view="stylus"]');
  await page.waitForTimeout(2500);
  await page.click('[data-view="groove"]');
  await page.waitForTimeout(11000);
  console.log('1979 groove', JSON.stringify(await state()));
  await page.click('[data-view="overview"]');
  await page.waitForTimeout(3000);
  console.log('1979 overview', JSON.stringify(await state()));
  await page.click('[data-player="gramophone-1925"]');
  await page.waitForTimeout(5000);
  await page.click('[data-view="groove"]');
  await page.waitForTimeout(8000);
  console.log('1925 groove', JSON.stringify(await state()));
  await page.click('[data-view="overview"]');
  await page.waitForTimeout(3000);
  await page.click('[data-player="phonograph-1877"]');
  await page.waitForTimeout(4000);
  await page.click('[data-view="groove"]');
  await page.waitForTimeout(3000);
  console.log('1877 groove', JSON.stringify(await state()));
  const cutEndsAt = Date.now();

  const video = page.video();
  await context.close();
  const videoPath = await video.path();
  const outputPath = path.join(outputDirectory, `groove-view-${width}x${height}.mp4`);
  const result = spawnSync('ffmpeg', [
    '-y', '-ss', ((cutStartsAt - videoStartedAt) / 1000).toFixed(3), '-i', videoPath,
    '-t', ((cutEndsAt - cutStartsAt) / 1000).toFixed(3),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', '30', '-an',
    '-movflags', '+faststart', outputPath,
  ], { encoding: 'utf8' });
  if (result.status !== 0) console.log(result.stderr.slice(-1500));
  console.log(outputPath);
} finally {
  await browser.close();
  server.kill();
}
