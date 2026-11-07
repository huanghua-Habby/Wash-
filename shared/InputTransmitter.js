/** Change-driven input transport; local prediction remains 60 Hz independently of message frequency. */
import { INPUT_HEARTBEAT_SECONDS, INPUT_DIRECTION_SECONDS } from './protocol.js';
export class InputTransmitter {
  constructor() { this.reset(); }
  reset() { this.previous=null;this.lastSent=-Infinity; }
  /** Button/axis edges send immediately; orientation refresh is bounded and unchanged input only sends a keepalive. */
  shouldSend(packet,time) {
    const old=this.previous;
    const buttonsChanged=!old || old.down.length!==packet.down.length || old.down.some(key=>!packet.down.includes(key));
    const axisChanged=!old || old.axis.some((value,i)=>value!==packet.axis[i]);
    const directionChanged=!old || old.move.some((value,i)=>Math.abs(value-packet.move[i])>0.0001);
    const elapsed=time-this.lastSent;
    if(!old || buttonsChanged || axisChanged || packet.hits.length || packet.struggle || directionChanged && elapsed>=INPUT_DIRECTION_SECONDS-1e-9 || elapsed>=INPUT_HEARTBEAT_SECONDS-1e-9) {
      this.previous={axis:[...packet.axis],move:[...packet.move],down:[...packet.down]};this.lastSent=time;return true;
    }
    return false;
  }
}
