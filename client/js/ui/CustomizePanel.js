import { localizedText, localizedAttr, localizedNode, format, literal } from '../i18n/Localization.js';
import * as THREE from 'three';
import { Player } from '../game/Player.js';
import { identityRings } from '../render/IdentityRings.js';
import { SceneReadiness } from '../render/SceneReadiness.js';
import { AVATAR_COLORS, COLOR_NAMES, ANIMALS, breedInfo, cleanAvatar } from '../../../shared/avatar.js';
import { ANIMAL_DESCRIPTIONS } from './animalDescriptions.js';

/** A private draft and a prepared 3D preview. Only the registry's confirmed roster changes the world. */
export class CustomizePanel {
  constructor({ connection, ui }) {
    Object.assign(this, { connection, ui });
    this.dialog = document.getElementById('customize-dialog'); this.pending = false;
    this.confirm = this.dialog.querySelector('.customize-confirm'); this.error = this.dialog.querySelector('.customize-error');
    this.previewName = this.dialog.querySelector('.customize-preview-name');
    this.ability = this.dialog.querySelector('.customize-ability');
    this.colorNote = this.dialog.querySelector('.color-note');
    // Switching animal keeps the last breed picked for that animal during this draft.
    this.lastBreed = {};
    this.animalButtons = ANIMALS.map(animal => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'animal-choice'; button.dataset.animal = animal.id;
      const tag = document.createElement('span'); localizedText(tag, ANIMAL_DESCRIPTIONS[animal.id]?.tag || '');
      button.append(localizedNode(animal.name), ' ', tag);
      ui.listen(button, 'click', () => {
        if (this.draft.animal === animal.id) return;
        this.lastBreed[this.draft.animal] = this.draft.breed;
        this.draft.animal = animal.id; this.draft.breed = this.lastBreed[animal.id] || animal.breeds[0].id; this.refresh();
      });
      this.dialog.querySelector('.animal-choices').appendChild(button); return button;
    });
    this.breedButtons = ANIMALS.flatMap(animal => animal.breeds.map(breed => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'breed-choice';
      button.dataset.animal = animal.id; button.dataset.breed = breed.id;
      const mark = document.createElement('i'); mark.className = `coat-sample ${animal.id}-sample coat-${breed.id}`;
      const label = document.createElement('span'); localizedText(label, breed.name); button.append(mark, label);
      ui.listen(button, 'click', () => { this.draft.breed = breed.id; this.refresh(); });
      this.dialog.querySelector('.breed-choices').appendChild(button); return button;
    }));
    this.colorButtons = AVATAR_COLORS.map((color, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'color-choice'; button.dataset.color = index;
      button.style.setProperty('--swatch', color); localizedAttr(button, 'aria-label', format("{0}色", COLOR_NAMES[index]));
      ui.listen(button, 'click', () => { this.draft.color = index; this.refresh(); });
      this.dialog.querySelector('.color-choices').appendChild(button); return button;
    });
    ui.listen(document.getElementById('customize-player'), 'click', () => ui.open('customize'));
    ui.listen(this.dialog.querySelector('.customize-close'), 'click', () => ui.close('customize'));
    ui.listen(this.dialog.querySelector('.customize-cancel'), 'click', () => ui.close('customize'));
    ui.listen(this.dialog, 'cancel', event => { event.preventDefault(); ui.close('customize'); });
    ui.listen(this.confirm, 'click', () => this.commit());

    const canvas = this.dialog.querySelector('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); this.renderer.setSize(360, 360, false);
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene(); this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    this.camera.position.set(2.6, 1.7, 2.7); this.camera.lookAt(0, 0.55, 0);
    this.scene.add(new THREE.HemisphereLight('#fff9e9', '#818f86', 2));
    const light = new THREE.DirectionalLight('#fff3dc', 2.4); light.position.set(2, 4, 3); light.castShadow = true;
    light.shadow.mapSize.set(512, 512); light.shadow.camera.near = 0.1; light.shadow.camera.far = 12;
    light.shadow.camera.left = light.shadow.camera.bottom = -2; light.shadow.camera.right = light.shadow.camera.top = 2;
    light.shadow.bias = -0.001; this.scene.add(light);
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.98, 0.12, 64), new THREE.MeshLambertMaterial({ color: '#efe5c9' }));
    floor.position.y = -0.065; floor.receiveShadow = true; this.scene.add(floor);
    this.preview = new Player(this.scene, { slot: 0 }); this.preview.state = 'ground'; this.preview.pos.set(0, 0, 0);
    this.rings = identityRings(this.scene);
    const post = { view: 0, render: () => this.renderer.render(this.scene, this.camera) };
    this.readiness = new SceneReadiness({ renderer: this.renderer, scene: this.scene, camera: this.camera, post });
    this.ready = Promise.all([this.preview.appearanceReady, this.readiness.prepare()]);
  }

  open() {
    if (this.pending || this.closing || !this.connection.connected || this.ui.page !== 'home' || this.connection.room?.phase !== 'home') return;
    const member = this.connection.room.members.find(member => member.id === this.connection.playerId);
    this.draft = cleanAvatar(member?.appearance, this.connection.room.slot); this.lastBreed = {}; localizedText(this.error, '');
    this.refresh(); this.ui.showDialog('customize');
  }

  close() {
    if (!this.dialog.open || this.closing) return;
    // The existing Settings flag disables CSS motion globally; no animated close wait in quiet mode.
    if (!this.ui.motionAllowed) { this.ui.close('customize', true); return; }
    this.closing = true; const transitionId = this.transitionId = (this.transitionId || 0) + 1;
    this.dialog.classList.add('closing');
    Promise.allSettled(this.dialog.getAnimations().map(animation => animation.finished)).then(() => {
      if (this.dialog.open && this.transitionId === transitionId) this.ui.close('customize', true);
    });
  }

  refresh() {
    if (this.disposed || !this.draft) return;
    const others = this.connection.room?.members.filter(member => member.id !== this.connection.playerId) || [];
    const used = new Set(others.map(member => cleanAvatar(member.appearance, member.slot).color));
    // Versus draws everyone in team colors: the own color is locked and keeps the confirmed one.
    const versus = this.ui.gameMode === 'versus';
    if (versus) {
      const member = this.connection.room.members.find(member => member.id === this.connection.playerId);
      this.draft.color = cleanAvatar(member?.appearance, this.connection.room.slot).color;
    }
    if (this.colorLocked !== versus) {
      this.colorLocked = versus; this.dialog.querySelector('.color-choices').classList.toggle('locked', versus);
      localizedText(this.colorNote, versus ? '对抗中按队伍颜色显示，不可更改' : '队友使用中的颜色不可选');
    }
    this.animalButtons.forEach(button => { button.setAttribute('aria-pressed', button.dataset.animal === this.draft.animal); button.disabled = this.pending; });
    this.breedButtons.forEach(button => {
      button.hidden = button.dataset.animal !== this.draft.animal;
      button.setAttribute('aria-pressed', !button.hidden && button.dataset.breed === this.draft.breed); button.disabled = this.pending;
    });
    this.colorButtons.forEach((button, color) => {
      const owner = others.find(member => cleanAvatar(member.appearance, member.slot).color === color);
      button.disabled = this.pending || versus || used.has(color); button.setAttribute('aria-pressed', color === this.draft.color);
      localizedAttr(button, "title", owner ? format("{0}色 · {1} 正在使用", COLOR_NAMES[color], literal(owner.name)) : format("{0}色", COLOR_NAMES[color]));
      button.classList.toggle('occupied', !!owner);
    });
    this.confirm.disabled = this.pending || !this.connection.connected || used.has(this.draft.color);
    localizedText(this.confirm, this.pending ? '确认中…' : '确定');
    this.dialog.querySelector('.customize-close').disabled = this.dialog.querySelector('.customize-cancel').disabled = this.pending;
    this.preview.setAppearance(this.draft); localizedText(this.previewName, breedInfo(this.draft.animal, this.draft.breed).name);
    this.showAbility(ANIMAL_DESCRIPTIONS[this.draft.animal]);
    this.dialog.querySelector('.customize-preview').style.setProperty('--preview-accent', AVATAR_COLORS[this.draft.color]);
    this.render(0);
  }

  showAbility(info) {
    this.ability.hidden = !info;
    if (!info) return;
    localizedText(this.ability.querySelector('.ability-type'), info.type || '');
    localizedText(this.ability.querySelector('.ability-description'), info.description);
    // One key row per action; rows are reused across animal changes and extras stay hidden.
    const list = this.ability.querySelector('.ability-actions'), actions = info.actions || [];
    list.hidden = !actions.length;
    while (list.children.length < actions.length) {
      const row = document.createElement('div'); row.className = 'ability-action';
      row.append(document.createElement('kbd'), document.createElement('span')); list.append(row);
    }
    [...list.children].forEach((row, i) => {
      row.hidden = i >= actions.length;
      if (row.hidden) return;
      localizedText(row.querySelector('kbd'), actions[i].key); localizedText(row.querySelector('span'), actions[i].description);
    });
  }

  async commit() {
    if (this.confirm.disabled || this.closing) return;
    this.pending = true; localizedText(this.error, ''); this.refresh();
    try { await this.connection.customize(this.draft); this.close(); }
    catch (error) { localizedText(this.error, error.message); }
    finally { this.pending = false; this.refresh(); }
  }

  onClosed() {
    this.transitionId = (this.transitionId || 0) + 1;
    this.closing = false; this.dialog.classList.remove('closing');
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.onClosed(); this.rings.dispose(); this.renderer.dispose();
    [...this.animalButtons, ...this.breedButtons, ...this.colorButtons].forEach(button => button.remove());
    this.scene.traverse(node => { node.geometry?.dispose(); if (node.material) {
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose();
    } });
    this.scene.clear();
  }

  render(dt) {
    if (this.disposed || (!this.dialog.open && dt > 0)) return;
    this.preview.updateVisual(dt); this.renderer.render(this.scene, this.camera);
  }
}
