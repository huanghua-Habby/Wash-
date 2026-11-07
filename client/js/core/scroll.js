import * as THREE from 'three';
import { wrap } from '../../../shared/sim/util.js';
import { FIRST_LEVEL_ID, getLevel } from '../../../shared/levels.js';

// 世界是“跑步机”：卡车留在原点附近，路边一切以 scroll 向后循环滚动。
export const WORLD_LEN = getLevel(FIRST_LEVEL_ID).road.loopLength;

export class ScrollGroup {
  constructor(L = WORLD_LEN) {
    this.L = L;
    this.items = [];
  }
  add(obj, x) {
    this.items.push({ obj, x });
    obj.position.x = x;
    return obj;
  }
  update(scroll) {
    for (const it of this.items) it.obj.position.x = wrap(it.x - scroll, this.L);
  }
}

// 大量重复小物件（护栏柱、栅栏板）用实例化
export class ScrollInstances {
  constructor(meshes, items, L = WORLD_LEN) {
    this.meshes = meshes;
    this.items = items;
    this.L = L;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._up = new THREE.Vector3(0, 1, 0);
    for (const m of meshes) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
  }
  update(scroll) {
    const { _m, _q, _p, _s, _up } = this;
    this.items.forEach((it, i) => {
      _p.set(wrap(it.x - scroll, this.L), it.y || 0, it.z);
      _q.setFromAxisAngle(_up, it.ry || 0);
      _s.set(1, it.sy || 1, 1);
      _m.compose(_p, _q, _s);
      for (const mesh of this.meshes) mesh.setMatrixAt(i, _m);
    });
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
  }
}
