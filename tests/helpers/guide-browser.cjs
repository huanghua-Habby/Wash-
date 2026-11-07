/** Gameplay regressions opt into a UI reader; dedicated guide/round tests confirm explicitly. */
async function installGuideReader(browser) {
  const read = () => {
    const observer = new MutationObserver(() => {
      const dialog = document.getElementById('level-guide'), button = dialog?.querySelector('.level-guide-confirm');
      if (dialog?.open && button && !button.disabled && !dialog.classList.contains('closing')) button.click();
    });
    observer.observe(document, {subtree:true,childList:true,attributes:true,attributeFilter:['open','disabled']});
    addEventListener('pagehide', () => observer.disconnect(), {once:true});
  };
  const context = browser.newContext.bind(browser), page = browser.newPage.bind(browser);
  browser.newContext = async (...args) => { const result = await context(...args); await result.addInitScript(read); return result; };
  browser.newPage = async (...args) => { const result = await page(...args); await result.addInitScript(read); return result; };
}
module.exports = {installGuideReader};
