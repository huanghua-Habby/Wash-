/** Direct-link probe: one host browser and three guests (Chrome contexts on THIS machine) join through room codes, then
 * report data-channel RTT, snapshot rate, input confirmation and the ICE candidate pair each guest actually uses.
 * It measures this machine to the given page; for coworkers' devices read the debug panel (` key) on each device.
 * Usage: node scripts/probe-room-latency.mjs [page-url] [seconds]   (default http://127.0.0.1:8080/, 10 s) */
import { chromium } from 'playwright';

const page = new URL(process.argv[2] || 'http://127.0.0.1:8080/');
page.searchParams.set('wash-test', '1');
const seconds = Number(process.argv[3] || 10);
if (!Number.isFinite(seconds) || seconds < 5 || seconds > 120) throw new Error('Duration must be 5–120 seconds');
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b), at = (p) => Math.round((sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0) * 10) / 10;
  return { samples: sorted.length, p50: at(0.5), p95: at(0.95), max: at(1) };
};

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const pages = [];
  for (let i = 0; i < 4; i++) {
    const tab = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    await tab.goto(page.href); await tab.waitForSelector('body.scene-ready', { timeout: 60000 }); pages.push(tab);
  }
  const code = await pages[0].locator('#room-code-value').textContent();
  const start = Date.now();
  for (const guest of pages.slice(1)) { await guest.locator('#join-code').fill(code); await guest.locator('#join-room').click(); }
  await Promise.all(pages.slice(1).map((guest) => guest.waitForFunction(() => __wash.connection.guest?.open && __wash.network.latest, null, { timeout: 20000 })));
  const linkMs = Date.now() - start;
  const samples = { rtt: [], snapshotHz: [], gapMs: [], ackMs: [], delayMs: [], correctionCm: [] };
  for (let t = 0; t < seconds; t++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    for (const guest of pages.slice(1)) {
      const s = await guest.evaluate(() => __wash.network.stats);
      samples.rtt.push(s.rttMs); samples.snapshotHz.push(s.snapshotHz); samples.gapMs.push(s.gapMaxMs);
      samples.ackMs.push(s.ackMs); samples.delayMs.push(s.delayMs); samples.correctionCm.push(s.correctionCm);
    }
  }
  const pairs = await Promise.all(pages.slice(1).map((guest) => guest.evaluate(async () => {
    const report = await __wash.connection.guest.link.pc.getStats(); let pair = null; const byId = new Map();
    report.forEach((entry) => { byId.set(entry.id, entry); if (entry.type === 'candidate-pair' && entry.nominated && entry.state === 'succeeded') pair = entry; });
    const side = (id) => { const c = byId.get(id); return c && `${c.candidateType}/${c.protocol}`; };
    return pair ? { local: side(pair.localCandidateId), remote: side(pair.remoteCandidateId), rttMs: (pair.currentRoundTripTime ?? 0) * 1000 } : null;
  })));
  console.log(JSON.stringify({ page: page.origin + page.pathname, sameMachine: true, guests: 3, linkReadyMs: linkMs,
    dataChannelRttMs: stats(samples.rtt), snapshotHz: stats(samples.snapshotHz), worstSnapshotGapMs: stats(samples.gapMs),
    inputConfirmMs: stats(samples.ackMs), interpolationDelayMs: stats(samples.delayMs), worstCorrectionCm: stats(samples.correctionCm), icePairs: pairs }, null, 2));
} finally { await browser.close(); }
