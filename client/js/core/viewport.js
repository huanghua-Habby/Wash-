// A desktop 16:9 play area. Smaller windows scale the same composition.
export const UI_WIDTH = 1440;
export const UI_HEIGHT = 810;

export function viewportSize() {
  const frame = document.getElementById('app-frame');
  return { width: frame.clientWidth, height: frame.clientHeight };
}

export function fitViewport() {
  const { width } = viewportSize();
  document.getElementById('ui-stage').style.setProperty('--ui-scale', width / UI_WIDTH);
}
