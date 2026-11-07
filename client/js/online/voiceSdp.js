/** Party-voice SDP shaping (VOICE_CHAT.md 语音优化). With voice optimization on, the Opus line asks for DTX (no packets
 * while nobody speaks), a 24 kbps mono cap and 40 ms packets (half the packet rate, +20 ms latency); off removes them.
 * Applied to both the local and the remote description, so this page's own encoder follows its own setting and the
 * other side is asked to do the same. Pure string work, no browser APIs. */
export const VOICE_BITRATE = 24000;
const OPTIMIZED = Object.freeze({ usedtx: '1', maxaveragebitrate: String(VOICE_BITRATE), stereo: '0' });
const PTIME = 40;

export function shapeVoiceSdp(sdp, optimized) {
  if (typeof sdp !== 'string') return sdp;
  const pt = /^a=rtpmap:(\d+) opus\/48000/im.exec(sdp)?.[1];
  if (!pt) return sdp;
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(eol);
  // The audio m-section holding Opus: from its m= line to the next m= line.
  const start = lines.findIndex((line, i) => line.startsWith('m=audio') && lines.slice(i + 1, nextSection(lines, i)).some((l) => l.startsWith(`a=rtpmap:${pt} `)));
  if (start < 0) return sdp;
  const end = nextSection(lines, start);
  const section = lines.slice(start, end).filter((line) => !line.startsWith('a=ptime:'));
  let fmtp = section.findIndex((line) => line.startsWith(`a=fmtp:${pt} `));
  if (fmtp < 0) { section.push(`a=fmtp:${pt} minptime=10;useinbandfec=1`); fmtp = section.length - 1; }
  const params = new Map(section[fmtp].slice(`a=fmtp:${pt} `.length).split(';').filter(Boolean).map((pair) => {
    const at = pair.indexOf('='); return at < 0 ? [pair.trim(), ''] : [pair.slice(0, at).trim(), pair.slice(at + 1).trim()];
  }));
  for (const [key, value] of Object.entries(OPTIMIZED)) if (optimized) params.set(key, value); else if (key !== 'stereo') params.delete(key);
  section[fmtp] = `a=fmtp:${pt} ${[...params].map(([key, value]) => value === '' ? key : `${key}=${value}`).join(';')}`;
  if (optimized) section.splice(fmtp + 1, 0, `a=ptime:${PTIME}`);
  return [...lines.slice(0, start), ...section, ...lines.slice(end)].join(eol);
}

function nextSection(lines, from) {
  const next = lines.findIndex((line, i) => i > from && line.startsWith('m='));
  return next < 0 ? lines.length : next;
}
