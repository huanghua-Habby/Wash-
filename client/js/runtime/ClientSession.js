/** Client commands and local-slot bindings. No authority rules or wire parsing live here. */
export class ClientSession {
  constructor({ ui, input, connection, practice }) {
    Object.assign(this, { ui, input, connection, practice });
    this.player = practice.players[0]; this.boundRoom = null; this.boundSlot = null;
  }
  bindGame(game) { this.game = game; }
  localPlayer() { return this.player; }
  presentationBase() { return this.network?.latest?.base || this.practice.director.base; }
  canPlay() { return this.connection.playing; }
  canControl() { return this.connection.connected && !!this.connection.room?.ownCode && !this.connection.room.homeWaiting?.length; }
  requestStart(levelId) { return this.connection.send('start', { levelId }); }
  requestLoad(levelId) { return this.connection.send('load', { levelId }); }
  /** Co-op: the host's open menu pauses the room. Versus: menus never freeze the match; players request a pause instead. */
  requestPause(paused) {
    if (this.connection.room?.ownCode && !this.game.ended && this.game.mode !== 'versus') this.connection.send('pause', { paused });
    this.input.clear();
  }
  requestVersusPause() { return this.connection.send('pause_request'); }
  voteResume() { return this.connection.send('resume_vote'); }
  results() { return { score: this.game.score, completed: this.game.completed }; }
  menuBindings() {
    return { canControl: this.canControl.bind(this), onRequestStart: this.requestStart.bind(this),
      onRequestLoad: this.requestLoad.bind(this), onPause: this.requestPause.bind(this), getResults: this.results.bind(this),
      onVersusPause: this.requestVersusPause.bind(this), onVoteResume: this.voteResume.bind(this) };
  }
  bind({ app, network, tasks }) {
    Object.assign(this, { network, tasks });
    tasks.bind(this.player, this.practice.trucks, this.practice.director); this.game.viewOnly = true;
    app.listen(this.connection, 'room', this.roomChanged.bind(this));
  }
  roomChanged() {
    const room = this.connection.room;
    const changed = this.boundRoom !== room.code || this.boundSlot !== room.slot;
    this.boundRoom = room.code; this.boundSlot = room.slot;
    this.player = this.practice.players[room.slot]; this.tasks.bind(this.player, this.practice.trucks, this.practice.director);
    if (this.network.phase !== 'home' || !changed) return;
    this.input.clear(); this.ui.focusGame();
  }
}
