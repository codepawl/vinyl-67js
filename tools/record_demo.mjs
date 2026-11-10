// Records the three machines playing one record, with the page's own sound, into renders/demo/.
// Usage: node tools/record_demo.mjs [width] [height]
// The page's audio never reaches the speakers: it is routed into a recorder inside the page.
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.resolve(projectDirectory, '../../../67js/package.json'));
const { chromium } = require('playwright');

const width = Number(process.argv[2] || 1280);
const height = Number(process.argv[3] || 720);
const recordId = 'gymnopedie';
const port = 4191;
const outputDirectory = path.join(projectDirectory, 'renders', 'demo');
const rawDirectory = path.join(outputDirectory, 'raw');
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
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

function routeAudioIntoRecorder() {
  const originalConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function connect(target, ...rest) {
    if (!(target instanceof AudioDestinationNode)) return originalConnect.call(this, target, ...rest);
    if (!window.demoAudio) {
      const sink = this.context.createMediaStreamDestination();
      const recorder = new MediaRecorder(sink.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 256000 });
      const chunks = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      window.demoAudio = { sink, recorder, chunks };
    }
    return originalConnect.call(this, window.demoAudio.sink);
  };
}

try {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    recordVideo: { dir: rawDirectory, size: { width, height } },
  });
  await context.addInitScript(routeAudioIntoRecorder);
  const page = await context.newPage();
  const videoStartedAt = Date.now();
  page.on('pageerror', (error) => console.log('pageerror', error.message));

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.evaluate(async (id) => {
    const debug = window.vinylDebug;
    await debug.changeRecord(debug.records.find((record) => record.id === id), false);
  }, recordId);
  await page.waitForFunction(() => !window.vinylDebug.recordChangeRunning(), null, { timeout: 60000 });
  await page.waitForTimeout(1500);

  const centreOf = async (selector) => {
    const box = await page.locator(selector).boundingBox();
    return [box.x + box.width / 2, box.y + box.height / 2];
  };
  const glide = async (x, y, milliseconds = 700) => {
    await page.mouse.move(x, y, { steps: Math.max(2, Math.round(milliseconds / 16)) });
  };
  const press = async (selector) => {
    const [x, y] = await centreOf(selector);
    await glide(x, y, 500);
    await page.mouse.click(x, y);
  };
  const at = (fractionX, fractionY) => [width * fractionX, height * fractionY];
  const rest = () => glide(...at(0.86, 0.3), 500);

  // The cut starts here: the needle goes down on the 1979 deck.
  const cutStartsAt = Date.now();
  await press('#play-btn');
  await page.evaluate(() => window.demoAudio && window.demoAudio.recorder.start(250));
  const audioStartedAt = Date.now();
  await rest();
  await page.waitForTimeout(6500);
  await glide(...at(0.41, 0.50), 900);
  await page.waitForTimeout(2600);
  await press('[data-view="stylus"]');
  await rest();
  await page.waitForTimeout(4500);
  await press('[data-view="overview"]');
  await page.waitForTimeout(1800);

  await press('[data-player="gramophone-1925"]');
  await rest();
  await page.waitForTimeout(5000);
  await glide(...at(0.41, 0.67), 900);
  await page.waitForTimeout(2600);
  await press('[data-view="stylus"]');
  await rest();
  await page.waitForTimeout(4200);
  await press('[data-view="overview"]');
  await page.waitForTimeout(1500);

  await press('[data-player="phonograph-1877"]');
  await rest();
  await page.waitForTimeout(5000);
  await glide(...at(0.44, 0.47), 900);
  await page.waitForTimeout(2600);
  await press('[data-view="profile"]');
  await rest();
  await page.waitForTimeout(4500);
  const cutEndsAt = Date.now();

  const audioBase64 = await page.evaluate(async () => {
    const { recorder, chunks } = window.demoAudio;
    await new Promise((resolve) => {
      recorder.onstop = resolve;
      recorder.stop();
    });
    const buffer = await new Blob(chunks, { type: 'audio/webm' }).arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    }
    return btoa(binary);
  });
  const audioPath = path.join(rawDirectory, 'audio.webm');
  writeFileSync(audioPath, Buffer.from(audioBase64, 'base64'));

  const video = page.video();
  await context.close();
  const videoPath = await video.path();

  const videoOffset = ((cutStartsAt - videoStartedAt) / 1000).toFixed(3);
  const audioLead = ((audioStartedAt - cutStartsAt) / 1000).toFixed(3);
  const duration = ((cutEndsAt - cutStartsAt) / 1000).toFixed(3);
  const outputPath = path.join(outputDirectory, `vinyl-three-machines-${width}x${height}.mp4`);
  const result = spawnSync('ffmpeg', [
    '-y', '-ss', videoOffset, '-i', videoPath,
    '-itsoffset', audioLead, '-i', audioPath,
    '-t', duration, '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outputPath,
  ], { encoding: 'utf8' });
  if (result.status !== 0) console.log(result.stderr.slice(-1500));
  console.log(JSON.stringify({ outputPath, videoOffset, audioLead, duration }));
} finally {
  await browser.close();
  server.kill();
}
