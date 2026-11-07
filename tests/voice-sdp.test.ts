import test from 'node:test';
import assert from 'node:assert/strict';
import { shapeVoiceSdp } from '../client/js/online/voiceSdp.js';

const SDP = ['v=0', 'o=- 1 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'm=audio 9 UDP/TLS/RTP/SAVPF 111 63', 'c=IN IP4 0.0.0.0',
  'a=rtpmap:111 opus/48000/2', 'a=fmtp:111 minptime=10;useinbandfec=1', 'a=rtpmap:63 red/48000/2', 'a=ptime:20',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'a=sctp-port:5000', ''].join('\r\n');

test('voice optimization asks Opus for DTX, a 24 kbps mono cap and 40 ms packets; only the audio section changes', () => {
  const on = shapeVoiceSdp(SDP, true);
  assert.match(on, /a=fmtp:111 minptime=10;useinbandfec=1;usedtx=1;maxaveragebitrate=24000;stereo=0\r\na=ptime:40\r\n/);
  assert.equal((on.match(/a=ptime:/g) || []).length, 1, 'one ptime, ours');
  assert.ok(on.endsWith('a=sctp-port:5000\r\n'), 'the data channel section is untouched');
  assert.equal(shapeVoiceSdp(on, true), on, 'shaping twice changes nothing');
});

test('voice optimization off removes DTX, the cap and the ptime; SDP without Opus passes through', () => {
  const off = shapeVoiceSdp(shapeVoiceSdp(SDP, true), false);
  assert.match(off, /a=fmtp:111 minptime=10;useinbandfec=1;stereo=0\r\n/);
  assert.doesNotMatch(off, /usedtx|maxaveragebitrate|a=ptime/);
  const data = 'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n';
  assert.equal(shapeVoiceSdp(data, true), data);
});
