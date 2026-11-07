import { CFG, loadSavedConfig, applyConfig } from './config.js';
import { applyTimeOfDay } from '../render/TimeOfDay.js';
import { syncGlow } from '../render/GlowMaterials.js';

/** Startup-only config overrides; they never write the saved day baseline. */
export function loadStartupConfig(search = location.search) {
  loadSavedConfig();
  const fx = new URLSearchParams(search).get('fx');
  if (fx) for (const pair of fx.split(',')) {
    const [path, raw] = pair.split(':'), [group, key] = path.split('.');
    if (!CFG[group] || !(key in CFG[group])) continue;
    const current = CFG[group][key];
    CFG[group][key] = typeof current === 'number' ? Number(raw) : typeof current === 'boolean' ? raw === 'true' : raw;
  }
  applyConfig({ fur: CFG.fur }); // URL overrides obey the same release limits as saved settings.
  applyTimeOfDay(0); syncGlow();
}

export function startupOptions(search = location.search) {
  const params = new URLSearchParams(search);
  return { debug: search.includes('debug'), view: params.get('view'), test: params.has('wash-test') };
}

/** Browser test handles remain opt-in, including aliases used by existing smoke tests. */
export function exposeTestState(state) {
  if (startupOptions().test) globalThis.__wash = { ...state, customize: state.ui.customize, renderConfig: CFG.render };
}
