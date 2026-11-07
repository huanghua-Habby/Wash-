import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GUIDE_DEFINITIONS } from '../shared/guideDefinitions.js';
import { GUIDE_CONTENT, validateGuideResources } from '../client/js/ui/GuideResources.js';

const readAlt = (url: URL) => readFileSync(url, 'utf8').replace(/\r\n/g, '\n');

test('final art hooks have one matching authority/UI image page, complete alt and shared instructions', () => {
  validateGuideResources();
  for (const id of ['tools-water', 'tools-soap', 'tools-charging', 'hazard-road-sign'] as const) {
    assert.equal(GUIDE_DEFINITIONS[id].pages.length, 1, `${id}:0 is the only authority page`);
    assert.equal(GUIDE_CONTENT[id].length, 1, `${id}:0 is the only prepared UI page`);
    const page = GUIDE_CONTENT[id][0];
    assert.ok(page.image && page.alt);
    assert.equal(page.alt, readAlt(new URL(`../client/assets/guides/${id}.alt.txt`, import.meta.url)), `${id} preserves the delivered complete alt`);
    const english = page.locales.en;
    assert.ok(english.image.includes(`${id}.en`));
    assert.equal(english.alt, readAlt(new URL(`../client/assets/guides/${id}.en.alt.txt`, import.meta.url)), `${id} preserves the English artist's alt`);
    assert.ok(readFileSync(new URL(`../client/assets/guides/${id}.en.webp`, import.meta.url)).length > 0);
  }
  assert.equal(GUIDE_CONTENT['tools-water'][0].title, '毛巾');
  assert.equal(GUIDE_CONTENT['tools-soap'][0].title, '肥皂');
  assert.equal(GUIDE_CONTENT['tools-charging'][0].title, '充电');
  assert.equal(GUIDE_CONTENT['hazard-road-sign'][0].title, '公告牌');
  const charging = GUIDE_DEFINITIONS['tools-charging'].pages[0];
  for (const detail of ['J', '6秒', '50%', '不叠加', '后来车辆', '洗净', '收卷', '长度', '召回', '积水', '触电']) assert.ok(charging.includes(detail), detail);
});
