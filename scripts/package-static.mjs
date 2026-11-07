/** Build the Game Share client ZIP with an explicit PC room endpoint; no server code is uploaded. */
import { build } from 'vite';
import { mkdir, rm, readdir, readFile, writeFile, stat, rename } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const configured = process.argv[2] || process.env.VITE_ROOM_WS_URL;
if (!configured) throw new Error('请指定本机房间服，例如 npm run package:static -- ws://192.168.1.10:8080/ws');
const endpoint = new URL(configured);
if (!['ws:', 'wss:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error('无效的房间服地址');
process.env.VITE_ROOM_WS_URL = endpoint.href;
const output = path.join(root, 'dist/game-share');
await build({ configFile: path.join(root, 'vite.config.js'), build: { outDir: output, emptyOutDir: true } });
await compressAudio(output);
const packages = path.join(root, 'dist/packages');
await mkdir(packages, { recursive: true });
const versionTag = (await readFile(path.join(root, 'client/index.html'), 'utf8')).match(/<meta\b[^>]*\bname=["']application-version["'][^>]*>/)?.[0];
const appVersion = versionTag?.match(/\bcontent=["']([^"']+)["']/)?.[1];
if (!/^\d+(?:\.\d+){1,2}$/.test(appVersion || '')) throw new Error('client/index.html 缺少有效的 application-version');
const archiveName = `WASH-v${appVersion}-static.zip`;
const archive = path.join(packages, archiveName);
const temporaryArchive = path.join(packages, `.${archiveName}.tmp.zip`);
await rm(temporaryArchive, { force: true });
try {
  const result = spawnSync('zip', ['-9qr', temporaryArchive, 'index.html', 'assets'], { cwd: output, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('ZIP 打包失败');
  await rename(temporaryArchive, archive);
} finally { await rm(temporaryArchive, { force: true }); }
if (process.env.WASH_KEEP_OLD_PACKAGES !== '1') {
  for (const name of await readdir(packages)) {
    if (name !== archiveName && /^(?:wash-lan-static|WASH-v\d+(?:\.\d+)*-static)\.zip$/.test(name)) {
      await rm(path.join(packages, name));
    }
  }
}
console.log(`静态 ZIP：${archive}\n房间服：${endpoint.href}\nPC 运行 npm run lan；发布网页需允许局域网访问。`);

/**
 * Upload-only audio shrink (source assets stay untouched): WAV effects become lossless FLAC, so loops stay sample-exact;
 * music above 150 kbps is re-encoded to 128 kbps MP3, whose gapless header keeps the length and the loop points.
 * Hashed file names are rewritten in the built JS/CSS/HTML. Set WASH_KEEP_AUDIO=1 to skip.
 */
async function compressAudio(dir) {
  if (process.env.WASH_KEEP_AUDIO) return;
  const assets = path.join(dir, 'assets'), names = await readdir(assets), renames = new Map();
  const ffmpeg = (args) => { const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]); if (r.status !== 0) throw new Error(`ffmpeg 失败：${r.stderr}`); };
  const bitrate = (file) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=bit_rate', '-of', 'csv=p=0', file]).stdout.toString().trim()) || 0;
  let before = 0, after = 0;
  for (const name of names) {
    const file = path.join(assets, name);
    if (name.endsWith('.wav')) {
      const flac = name.replace(/\.wav$/, '.flac'), target = path.join(assets, flac);
      ffmpeg(['-i', file, '-c:a', 'flac', '-compression_level', '12', target]);
      const [a, b] = [(await stat(file)).size, (await stat(target)).size];
      before += a;
      if (b < a) { await rm(file); renames.set(name, flac); after += b; } else { await rm(target); after += a; }
    } else if (name.endsWith('.mp3') && bitrate(file) > 150_000) {
      const target = `${file}.tmp.mp3`;
      ffmpeg(['-i', file, '-c:a', 'libmp3lame', '-b:a', '128k', target]);
      const [a, b] = [(await stat(file)).size, (await stat(target)).size];
      before += a; after += Math.min(a, b);
      if (b < a) await writeFile(file, await readFile(target));
      await rm(target);
    }
  }
  for (const name of [...names.filter((n) => /\.(js|css)$/.test(n)).map((n) => path.join(assets, n)), path.join(dir, 'index.html')]) {
    let text = await readFile(name, 'utf8'), changed = false;
    for (const [from, to] of renames) if (text.includes(from)) { text = text.split(from).join(to); changed = true; }
    if (changed) await writeFile(name, text);
  }
  console.log(`音频压缩：${(before / 1e6).toFixed(2)} MB → ${(after / 1e6).toFixed(2)} MB（${renames.size} 个音效转 FLAC）`);
}
