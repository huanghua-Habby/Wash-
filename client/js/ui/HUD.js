import { localizedText } from '../i18n/Localization.js';
const $ = (id) => document.getElementById(id);

// 目前只保留待办清单与操作提示
export class HUD {
  /** @param {{ onAllComplete?: () => void }} [options] */
  constructor({ onAllComplete = () => {} } = {}) {
    this.el = { todo: $('todo'), list: $('todo-list') };
    this.onAllComplete = onAllComplete;
    this.taskIds = new Set(); this.done = new Set(); this.completedOnce = false;
    try { this.completedOnce = localStorage.getItem('wash-checklist-complete') === 'true'; } catch { /* Optional UI preference. */ }
  }

  setTasks(tasks) {
    this.taskIds = new Set(tasks.map(task => task.id));
    this.done = new Set(this.completedOnce ? this.taskIds : []);
    this.el.list.replaceChildren(...tasks.map(task => {
      const item = document.createElement('li'); item.dataset.id = task.id; localizedText(item, task.text);
      item.classList.toggle('done', this.done.has(task.id)); return item;
    }));
  }

  complete(id) {
    if (!this.taskIds.has(id) || this.done.has(id)) return;
    this.done.add(id);
    const li = [...this.el.list.children].find(item => item.dataset.id === id);
    if (li) li.classList.add('done');
    if (!this.completedOnce && this.taskIds.size > 0 && this.done.size === this.taskIds.size) {
      this.completedOnce = true;
      try { localStorage.setItem('wash-checklist-complete', 'true'); } catch { /* Still remembers for this session. */ }
      this.onAllComplete();
    }
  }
}
