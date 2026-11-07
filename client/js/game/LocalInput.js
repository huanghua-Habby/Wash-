/** One local player's keyboard/gamepad, independent of their assigned room slot. */
const BUTTONS = { Space:0, KeyJ:2, KeyK:1, KeyL:4 };
/** Emote wheel: hold U or RB (button 5); see docs/domains/wash/EMOTES.md. */
const EMOTE_KEY = 'KeyU', EMOTE_BUTTON = 5;
export class LocalInput {
  constructor(source) { this.source=source; this.previous=[];this.buttons=[];this.stick={x:0,y:0}; this.holdMovement=false; }
  beginFrame() {
    const pad=navigator.getGamepads?.()[0];this.buttons=pad?pad.buttons.map(b=>b.pressed):[];
    this.stick.x=Math.abs(pad?.axes[0]||0)>0.18?pad.axes[0]:0;
    this.stick.y=Math.abs(pad?.axes[1]||0)>0.18?pad.axes[1]:0;
  }
  /** Movement axis; zero while the emote wheel uses WASD / the stick for picking. */
  axis() {
    if (!this.source.enabled || this.holdMovement) return {x:0,y:0};
    return this.rawAxis();
  }
  rawAxis() {
    if (!this.source.enabled) return {x:0,y:0};
    const keyboard=this.source.axis();return {x:Math.max(-1,Math.min(1,keyboard.x+this.stick.x)),y:Math.max(-1,Math.min(1,keyboard.y+this.stick.y))};
  }
  hit(key) { const button=BUTTONS[key];return this.source.enabled && (this.source.hit(key) || !!this.buttons[button] && !this.previous[button]); }
  down(key) { return this.source.enabled && (this.source.down(key) || !!this.buttons[BUTTONS[key]]); }
  /** Fresh key presses plus newly pressed face/shoulder buttons, for struggling out of a pelican pouch. */
  struggles() {
    if (!this.source.enabled) return 0;
    let count=this.source.struggles?.() || 0;
    for (let i=0;i<=4;i++) if (this.buttons[i] && !this.previous[i]) count++;
    return count;
  }
  emoteHeld() { return this.source.enabled && (this.source.down(EMOTE_KEY) || !!this.buttons[EMOTE_BUTTON]); }
  endFrame() {this.previous=[...this.buttons];}
  clear() {this.source.clear();this.previous=[...this.buttons];}
}
