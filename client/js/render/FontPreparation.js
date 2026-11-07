/** Canvas text resources use the existing three-second fallback policy. */
export async function prepareFonts() {
  let timer, complete = false;
  const stylesheet = document.getElementById('game-fonts'), listeners = new AbortController();
  const load = async () => {
    // The external stylesheet starts nonblocking. Include its request in the
    // same fallback budget: a render-blocking link would prevent main running.
    if (stylesheet && !stylesheet.sheet) await new Promise((resolve, reject) => {
      stylesheet.addEventListener('load', resolve, { once: true, signal: listeners.signal });
      stylesheet.addEventListener('error', reject, { once: true, signal: listeners.signal });
    });
    if (stylesheet) stylesheet.media = 'all';
    await Promise.all([
      document.fonts.load('64px "ZCOOL KuaiLe"', '方方快运圆圆物流镇哧溜~!WHOOSH'),
      document.fonts.load('600 64px "Fredoka"'), document.fonts.load('700 64px "Fredoka"'),
    ]);
    complete = true;
  };
  try {
    await Promise.race([
      load(),
      new Promise(resolve => { timer = setTimeout(resolve, 3000); }),
    ]);
  } catch { /* Keep fallback fonts. */ } finally {
    clearTimeout(timer); listeners.abort();
    if (!complete) stylesheet?.remove();
  }
}
