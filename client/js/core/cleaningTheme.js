/** One client palette: current cleaning action, tool body and HUD use the same identity. */
export const CLEANING_THEME = Object.freeze({
  soap: Object.freeze({ name: '肥皂', action: '打皂', accent: '#D98579', paper: '#FFF0E9', ink: '#88473F', model: '#EBA394' }),
  water: Object.freeze({ name: '水枪', action: '冲洗', accent: '#78A9C4', paper: '#EAF5FC', ink: '#38667F', model: '#93C4DF' }),
  towel: Object.freeze({ name: '毛巾', action: '擦净', accent: '#C8A13E', paper: '#FFF5D8', ink: '#735A20', model: '#E8C468' }),
});

/** Local CSS variables inherit through the prepared HUD; never use player/room text as markup. */
export function applyCleaningTheme(node, kind) {
  const theme = CLEANING_THEME[kind];
  if (!theme || node.dataset.tool === kind) return;
  node.dataset.tool = kind;
  node.style.setProperty('--clean-accent', theme.accent);
  node.style.setProperty('--clean-paper', theme.paper);
  node.style.setProperty('--clean-ink', theme.ink);
}
