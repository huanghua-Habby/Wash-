import { DebugPanel } from './DebugPanel.js';
import { syncGlow } from '../render/GlowMaterials.js';
import { startupOptions } from '../core/Startup.js';

/** Debug composition adapter; player-facing pages remain owned by UIManager. */
export function createDebugPanel({ render, environment, network }) {
  const debug = new DebugPanel({ post: render.post, resolution: render.resolution,
    onLightChange: environment.refreshLighting.bind(environment), onOutlineChange: environment.refreshOutline.bind(environment), onGlowChange: syncGlow,
    onSceneryChange: environment.refreshScenery.bind(environment), onSignsChange: environment.refreshSigns.bind(environment),
    onGroundChange: environment.refreshGround.bind(environment), onGrassDensityChange: environment.refreshGrassDensity.bind(environment) });
  document.getElementById('ui-stage').appendChild(debug.gui.domElement);
  environment.refreshLighting(); environment.refreshOutline();
  const options = startupOptions();
  if (options.debug) debug.toggle();
  if (options.view) render.post.view = Number(options.view);
  debug.attachPerf(render.perf); debug.attachNetwork(network.stats);
  return debug;
}
