// 待办清单
export const TASK_LIST = [
  { id: 'stand', text: '在洗车飞车上站稳' },
  { id: 'hop', text: '跳到蓝色飞车上' },
  { id: 'squeeze', text: '趁两车贴最近时跳过去' },
  { id: 'cab', text: '登上驾驶舱顶' },
  { id: 'jumps', text: '蹦跶 10 次' },
  { id: 'fall', text: '掉下去一次（没关系的）' },
];

export class Tasks {
  constructor(hud) {
    this.hud = hud;
    this.done = new Set();
    this.standTime = 0;
    this.jumps = 0;
    hud.setTasks(TASK_LIST);
  }

  complete(id) {
    if (this.done.has(id)) return;
    this.done.add(id);
    this.hud.complete(id);
  }

  bind(player, trucks, director) {
    if (this.player === player) return;
    this.unbind?.forEach((unsubscribe) => unsubscribe());
    this.unbind = [];
    const [A, B] = trucks;
    this.unbind.push(player.on('jump', () => {
      if (++this.jumps >= 10) this.complete('jumps');
    }));
    this.unbind.push(player.on('land', ({ truck, plat, from }) => {
      if (plat.name === 'cab') this.complete('cab');
      if (from && from !== truck) {
        if (truck === B) this.complete('hop');
        if (director.clearance < 0.85) this.complete('squeeze');
      }
    }));
    this.unbind.push(player.on('fall', () => this.complete('fall')));
    this.player = player;
    this.A = A;
  }

  update(dt) {
    const p = this.player;
    if (p.state === 'ground' && p.ground.truck === this.A) {
      this.standTime += dt;
      if (this.standTime > 3) this.complete('stand');
    }
  }
}
