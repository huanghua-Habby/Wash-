/** Browser regressions were written against the Chinese UI. The app now follows the browser language when no
 * preference is saved, and headless Chrome reports en-US, so contexts default to zh-CN unless a test sets `locale`. */
const { chromium } = require('playwright');
if (!chromium.__washLocale) {
  const launch = chromium.launch.bind(chromium);
  chromium.launch = async (...args) => {
    const browser = await launch(...args);
    const context = browser.newContext.bind(browser), page = browser.newPage.bind(browser);
    browser.newContext = (options = {}) => context({ locale: 'zh-CN', ...options });
    browser.newPage = (options = {}) => page({ locale: 'zh-CN', ...options });
    return browser;
  };
  chromium.__washLocale = true;
}
