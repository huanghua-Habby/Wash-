import test from 'node:test';
import assert from 'node:assert/strict';
import { Localization, LANGUAGE_KEY, detectLocale, format, literal } from '../client/js/i18n/Localization.js';
import { EN } from '../client/js/i18n/en.js';

test('language preference is validated, persistent and usable when storage is blocked', () => {
  const saved = new Map<string, string>();
  const storage = { getItem: (key: string) => saved.get(key), setItem: (key: string, value: string) => saved.set(key, value) };
  const local = new Localization({ storage: () => storage, languages: () => ['zh-CN'] });
  assert.equal(local.locale, 'zh');
  assert.equal(local.setLocale('fr'), false);
  assert.equal(saved.size, 0);
  assert.equal(local.setLocale('en'), true);
  assert.equal(saved.get(LANGUAGE_KEY), 'en');
  assert.equal(new Localization({ storage: () => storage }).locale, 'en');
  saved.set(LANGUAGE_KEY, 'invalid');
  assert.equal(new Localization({ storage: () => storage, languages: () => ['zh-CN'] }).locale, 'zh');
  const blocked = new Localization({ storage: () => { throw new Error('disabled'); }, languages: () => ['zh-CN'] });
  assert.equal(blocked.setLocale('en'), true);
  assert.equal(blocked.resolve('设置'), 'Settings');
});

test('browser language decides first, a saved manual choice wins, and detection never writes a preference', () => {
  const saved = new Map<string, string>();
  const storage = { getItem: (key: string) => saved.get(key), setItem: (key: string, value: string) => saved.set(key, value) };
  assert.equal(detectLocale(['en-US', 'zh-CN']), 'en');
  assert.equal(detectLocale(['ja-JP', 'zh-TW', 'en']), 'zh', 'first supported entry wins');
  assert.equal(detectLocale('zh-Hant-HK'), 'zh');
  assert.equal(detectLocale(['ja-JP', 'fr']), 'en', 'unsupported languages read English');
  assert.equal(detectLocale([]), 'zh'); assert.equal(detectLocale(undefined), 'zh');
  const english = new Localization({ storage: () => storage, languages: () => ['en-GB'] });
  assert.equal(english.locale, 'en'); assert.equal(saved.size, 0, 'detection is not saved');
  assert.equal(new Localization({ storage: () => storage, languages: () => ['zh-CN'] }).locale, 'zh');
  english.setLocale('zh');
  assert.equal(new Localization({ storage: () => storage, languages: () => ['en-GB'] }).locale, 'zh', 'manual choice beats the browser');
  saved.clear();
  new Localization({ storage: () => storage, languages: () => ['en-US'] }).setLocale('en');
  assert.equal(saved.get(LANGUAGE_KEY), 'en', 'choosing the detected language still saves it');
  assert.equal(new Localization({ storage: () => storage, languages: () => ['zh-CN'] }).locale, 'en');
  assert.equal(new Localization({ storage: () => null, languages: () => { throw new Error('blocked'); } }).locale, 'zh');
});

test('complete messages reorder nested parameters while names stay literal', () => {
  const local = new Localization({ languages: () => ['zh-CN'], storage: () => null, catalog: { '{name}，{action}': '{action}, {name}', '准备好了': 'Ready', '设置': 'Settings' } });
  const message = format('{name}，{action}', { name: literal('设置'), action: '准备好了' });
  assert.equal(local.resolve(message), '设置，准备好了');
  local.setLocale('en');
  assert.equal(local.resolve(message), 'Ready, 设置');
  assert.equal(local.resolve(literal('<img src=x onerror=alert(1)>')), '<img src=x onerror=alert(1)>');
  assert.equal(local.resolve('new-source-without-a-translation'), 'new-source-without-a-translation');
});

test('bound labels and accessibility attributes change in place and recover Chinese', () => {
  const local = new Localization({ languages: () => ['zh-CN'], storage: () => null });
  const attrs = new Map<string, string>();
  const node = { textContent: '', getAttribute: (key: string) => attrs.get(key), setAttribute: (key: string, value: string) => attrs.set(key, value) };
  local.text(node, '设置'); local.attr(node, 'aria-label', format('玩家 {0}', 2));
  local.setLocale('en');
  assert.equal(node.textContent, 'Settings'); assert.equal(attrs.get('aria-label'), 'Player 2');
  local.setLocale('zh');
  assert.equal(node.textContent, '设置'); assert.equal(attrs.get('aria-label'), '玩家 2');
});

test('English catalog preserves every interpolation field, including image alt text', () => {
  const fields = (value: string) => [...new Set(value.match(/\{\w+\}/g) || [])].sort();
  for (const [source, translation] of Object.entries(EN)) {
    assert.ok(translation.trim(), source);
    assert.deepEqual(fields(translation), fields(source), source);
  }
});

test('room arrival messages treat player IDs as literal data across language switches', async () => {
  const { RoomArrivalNotices } = await import('../client/js/ui/RoomArrivalNotices.js');
  const local = new Localization({ languages: () => ['zh-CN'], storage: () => null }), notices = new RoomArrivalNotices();
  const host = { id: 'host', name: '设置', connected: true }, guest = { id: 'guest', name: '<b>Jo</b>', connected: true };
  const own = { code: 'ABC234', hostId: 'host', playerId: 'host', members: [host] };
  notices.observe(own); assert.equal(notices.take(own), null, 'initial own room is quiet');
  const joined = { ...own, members: [host, guest] };
  notices.observe(joined); const message = notices.take(joined);
  assert.equal(local.resolve(message), '新玩家入场：<b>Jo</b>');
  local.setLocale('en'); assert.equal(local.resolve(message), 'New player joined: <b>Jo</b>');
  notices.observe(joined); assert.equal(notices.take(joined), null, 'duplicate roster does not repeat');
  const renamed = { ...joined, epoch: 9, members: [host, { ...guest, name: '房主', session: 'new-session' }] };
  notices.observe(renamed); assert.equal(notices.take(renamed), null, 'rename, epoch and session do not count as arrival');
  notices.observe({ ...renamed, members: [host, { ...guest, connected: false }] });
  notices.observe(renamed); assert.equal(notices.take(renamed), null, 'retained recovery seat is not a new member');
  notices.observe(own); notices.observe(joined); assert.ok(notices.take(joined), 'explicit leave and rejoin is new');

  const entering = new RoomArrivalNotices();
  const guestOwn = { code: 'DEF567', hostId: 'guest', playerId: 'guest', members: [guest] };
  const guestRoom = { ...joined, playerId: 'guest' };
  entering.observe(guestOwn); entering.observe(guestRoom);
  const welcome = entering.take(guestRoom);
  assert.equal(local.resolve(welcome), 'You joined 设置’s room!', 'host ID is never translated');
  local.setLocale('zh'); assert.equal(local.resolve(welcome), '已进入设置的房间！');
  entering.observe(guestRoom); assert.equal(entering.take(guestRoom), null);
  const restored = new RoomArrivalNotices(); restored.observe(guestRoom); assert.equal(restored.take(guestRoom), null, 'restored initial room is a baseline');
  entering.observe(guestOwn); entering.observe(guestRoom); entering.observe(guestOwn);
  assert.equal(entering.take(guestOwn), null, 'failed or abandoned join clears the pending welcome');
});

test('room arrival queue preserves simultaneous entrants and removes players who leave before display', async () => {
  const { RoomArrivalNotices } = await import('../client/js/ui/RoomArrivalNotices.js');
  const notices = new RoomArrivalNotices(), local = new Localization({ languages: () => ['zh-CN'], storage: () => null });
  const host = { id: 'host', name: 'A', connected: true }, b = { id: 'b', name: 'B', connected: true }, c = { id: 'c', name: 'C', connected: true };
  const room = { code: 'ABC234', hostId: 'host', playerId: 'host', members: [host] };
  notices.observe(room); notices.observe({ ...room, members: [host, b, c] });
  const remaining = { ...room, members: [host, c] }; notices.observe(remaining);
  assert.equal(local.resolve(notices.take(remaining)), '新玩家入场：C'); assert.equal(notices.take(remaining), null);
});
