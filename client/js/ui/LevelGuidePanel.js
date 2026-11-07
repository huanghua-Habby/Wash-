import { i18n, localizedText, localizedAttr, localizeMarkup, format, literal } from '../i18n/Localization.js';
/** Prepared guide view. Authority snapshots alone light the dots and release the barrier. */
import { GUIDE_CONTENT, validateGuideResources } from './GuideResources.js';

export class LevelGuidePanel {
  constructor(ui) {
    validateGuideResources();
    this.ui = ui; this.revision = 0; this.pending = false; this.closing = false; this.heldConfirmKeys = new Set();
    this.dialog = document.createElement('dialog'); this.dialog.id = 'level-guide'; this.dialog.className = 'level-guide';
    localizedAttr(this.dialog, 'aria-label', '新规则操作说明');
    (this.dialog.innerHTML = '<img class="level-guide-image" width="2560" height="1440"><div class="level-guide-body"><h2></h2><p class="level-guide-text"></p><p class="level-guide-draft">文字说明 · 配图制作中</p></div><div class="level-guide-footer"><span class="level-guide-pages"></span><div class="level-guide-dots" role="status" aria-live="polite"></div><button class="level-guide-confirm" type="button">确认 · J</button><p class="level-guide-note">全部玩家确认后开始</p></div>', localizeMarkup(this.dialog));
    this.body = this.dialog.querySelector('.level-guide-body'); this.title = this.dialog.querySelector('h2');
    this.text = this.dialog.querySelector('.level-guide-text'); this.draft = this.dialog.querySelector('.level-guide-draft');
    this.pages = this.dialog.querySelector('.level-guide-pages');
    this.image = this.dialog.querySelector('img'); this.button = this.dialog.querySelector('button');
    this.dotsRoot = this.dialog.querySelector('.level-guide-dots'); this.note = this.dialog.querySelector('.level-guide-note');
    this.dots = Array.from({ length: 8 }, (_, slot) => {
      const dot = document.createElement('span'); dot.className = 'level-guide-dot'; dot.dataset.slot = slot;
      dot.hidden = true; this.dotsRoot.appendChild(dot); return dot;
    });
    document.getElementById('ui-stage').appendChild(this.dialog);
    // Decode every configured guide before startup reveal; no image fetch/decoding on entry.
    this.images = Object.fromEntries(Object.entries(GUIDE_CONTENT).flatMap(([id, pages]) => pages.flatMap((page, index) => {
      if (!page.image) return [];
      return [[`${id}:${index}`, page], ...Object.entries(page.locales || {}).map(([locale, asset]) => [`${locale}:${id}:${index}`, asset])]
        .map(([key, asset]) => { const image = new Image(); image.src = asset.image; return [key, image]; });
    })));
    this.ready = Promise.all(Object.values(this.images).map(image => image.decode()));
    this.ready.catch(() => {});
    ui.listen(this.dialog, 'cancel', event => event.preventDefault());
    ui.listen(this.button, 'click', () => this.confirm());
    ui.listen(window, 'keydown', event => {
      // A held confirmation key remains consumed across Ready/Go until physical key-up.
      if (this.heldConfirmKeys.has(event.code)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      if (!ui.isPanelForeground('level-guide') || event.repeat || event.code !== 'KeyJ') return;
      this.heldConfirmKeys.add(event.code);
      event.preventDefault(); event.stopImmediatePropagation(); this.confirm(true);
    }, { capture: true });
    ui.listen(window, 'keyup', event => this.heldConfirmKeys.delete(event.code));
    ui.listen(window, 'blur', () => this.heldConfirmKeys.clear());
  }
  update(game, room) {
    if (this.ui.connection.guest?.rejoinPending || this.ui.connection.guest?.rejoinLeaving) { this.ui.close('level-guide', true); return; }
    const state = game.guide;
    if (game.roundStage !== 'guide' || this.ui.page !== 'game') { this.ui.close('level-guide', true); return; }
    const pageIndex = state.pageIndex ?? 0, pageCount = state.pageCount ?? 1;
    const page = GUIDE_CONTENT[state.id]?.[pageIndex];
    if (!page) throw new Error(`Guide page not prepared: ${state.id}:${pageIndex}`);
    const scope = `${room?.code}:${room?.epoch}:${room?.roundId || ''}:${state.id}:${pageIndex}`;
    if (scope !== this.scope) {
      this.reset(); this.scope = scope; this.id = state.id; this.pageIndex = pageIndex;
      this.image.hidden = !page.image; this.body.hidden = !!page.image;
      localizedText(this.title, page.title); localizedText(this.text, page.text || page.alt || ''); this.draft.hidden = !page.draft;
      localizedText(this.pages, format("第 {0} / {1} 页", pageIndex + 1, pageCount)); this.pages.hidden = pageCount <= 1;
    }
    this.state = state; this.slot = room?.slot ?? game.localSlot ?? 0;
    this.syncLanguage();
    const localReady = !!(state.ready & (1 << this.slot));
    const pageClosing = state.closeTime > 0;
    const complete = this.releasing = pageClosing && pageIndex === pageCount - 1;
    this.dots.forEach((dot, slot) => {
      dot.hidden = !(state.participants & (1 << slot));
      const ready = !!(state.ready & (1 << slot)); dot.classList.toggle('ready', ready);
      const name = room?.members?.find(member => member.slot === slot)?.name;
      const label = format('{0} · {1}', name ? literal(name) : format('玩家 {0}', slot + 1), ready ? '已准备' : '阅读中');
      localizedAttr(dot, 'title', label); localizedAttr(dot, 'aria-label', label);
      dot.classList.toggle('local', slot === this.slot);
    });
    localizedAttr(this.dotsRoot, 'aria-label', format("{0} 位玩家已准备", this.dots.filter(dot => !dot.hidden && dot.classList.contains('ready')).length));
    if (localReady) this.pending = false;
    this.button.disabled = localReady || this.pending || pageClosing || !(state.participants & (1 << this.slot)) || (this.ui.hasModal && !this.ui.isPanelForeground('level-guide'));
    localizedText(this.button, localReady ? '已准备' : this.pending ? '确认中…' : (pageIndex < pageCount - 1 ? '读完本页 · J' : '准备好了 · J'));
    // A timed guide (versus terminal) also says when it closes by itself.
    const left = state.timeout > 0 ? Math.max(0, Math.ceil(state.timeout - (state.elapsed || 0))) : 0;
    localizedText(this.note, pageClosing ? (complete ? '大家都准备好了！' : '一起翻到下一页…') : left ? format('全员按 J 或 {0} 秒后自动开始', left) : localReady ? '等其他玩家读完本页' : pageIndex < pageCount - 1 ? '全部玩家确认后翻页' : '全部玩家确认后开始');
    if (complete) this.ui.close('level-guide');
    else if (!this.dialog.open && !this.ui.iris.active) this.ui.open('level-guide');
  }
  syncLanguage() {
    if (!this.id || this.pageIndex === undefined) return;
    const page = GUIDE_CONTENT[this.id]?.[this.pageIndex]; if (!page?.image) return;
    const key = `${this.id}:${this.pageIndex}`, asset = page.locales?.[i18n.locale] || page;
    const image = this.images[`${i18n.locale}:${key}`] || this.images[key];
    if (this.image.src !== image.src) this.image.src = image.src;
    localizedAttr(this.image, 'alt', asset.alt);
  }
  confirm(keyboard = false) {
    if (!this.ui.isPanelForeground('level-guide') || this.closing || this.button.disabled || !this.state || this.ui.page !== 'game') return;
    if (this.ui.confirmGuide(this.id, keyboard, this.pageIndex)) { this.pending = true; this.button.disabled = true; }
  }
  close() {
    if (!this.dialog.open || this.closing) return;
    if (!this.ui.motionAllowed) { this.ui.close('level-guide', true); return; }
    this.closing = true; const revision = ++this.revision;
    this.dialog.classList.add('closing');
    Promise.allSettled(this.dialog.getAnimations().map(animation => animation.finished)).then(() => {
      if (revision === this.revision && this.dialog.open) this.ui.close('level-guide', true);
    });
  }
  reset() { ++this.revision; this.scope = null; this.state = null; this.releasing = false; this.pending = false; this.closing = false; this.dialog.classList.remove('closing'); }
  dispose() { this.reset(); this.heldConfirmKeys.clear(); this.dialog.remove(); this.images = {}; }
}
