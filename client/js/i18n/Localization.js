import { EN } from './en.js';

export const LANGUAGE_KEY = 'wash-language';
export const LANGUAGES = Object.freeze(['zh', 'en']);
const TOKEN = Symbol('localized-format'), LITERAL = Symbol('literal-text');
const han = value => /\p{Script=Han}/u.test(value);
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Source messages use the gettext convention; placeholders keep grammar out of UI code. */
export function format(source, ...values) {
  const params = values.length === 1 && values[0]?.constructor === Object && !values[0][TOKEN] && !values[0][LITERAL] ? values[0] : values;
  return { [TOKEN]: true, source, values: params };
}
/** Names, room codes and other user data must never become translation keys. */
export function literal(value) { return value?.[TOKEN] ? value : { [LITERAL]: true, value }; }

/** First supported entry of the browser's preferred languages (any Chinese variant → zh). Other languages read
 * English rather than Chinese; a browser that reports nothing keeps the Chinese source text. */
export function detectLocale(languages) {
  const list = (Array.isArray(languages) ? languages : [languages]).filter(tag => typeof tag === 'string' && tag);
  if (!list.length) return 'zh';
  for (const tag of list) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    if (LANGUAGES.includes(base)) return base;
  }
  return 'en';
}
const browserLanguages = () => { const nav = globalThis.navigator; return nav?.languages?.length ? nav.languages : nav?.language; };

export class Localization extends EventTarget {
  /** A saved manual choice wins; otherwise the browser language decides and nothing is written until the player toggles.
   * @param {{storage?: () => {getItem(key: string): string | null | undefined, setItem(key: string, value: string): void} | null | undefined, catalog?: Readonly<Record<string, string>>, languages?: () => string | readonly string[] | null | undefined}} [options] */
  constructor({ storage = () => globalThis.localStorage, catalog = EN, languages = browserLanguages } = {}) {
    super(); this.storage = storage; this.catalog = catalog; this.revision = 0;
    this.nodes = new WeakMap(); this.references = new Set();
    try { this.locale = detectLocale(languages()); } catch { this.locale = 'zh'; }
    try { const saved = storage()?.getItem(LANGUAGE_KEY); if (LANGUAGES.includes(saved)) this.locale = saved; } catch { /* Optional preference. */ }
    this.patterns = Object.entries(catalog).filter(([source]) => /\{\d+\}/.test(source) && !source.includes('<'))
      .sort(([a], [b]) => b.length - a.length).map(([source, translation]) => {
        const fields = []; let end = 0, pattern = '^';
        for (const token of source.matchAll(/\{(\d+)\}/g)) {
          pattern += escape(source.slice(end, token.index)) + '([\\s\\S]*?)'; fields.push(Number(token[1])); end = token.index + token[0].length;
        }
        return { source, translation, fields, regex: new RegExp(pattern + escape(source.slice(end)) + '$') };
      });
  }
  resolve(value) {
    if (value?.[LITERAL]) return String(value.value ?? '');
    if (value?.[TOKEN]) return this.translate(value.source, value.values);
    const source = String(value ?? '');
    if (this.locale === 'zh') return source;
    if (Object.hasOwn(this.catalog, source)) return this.catalog[source];
    if (!han(source)) return source;
    for (const entry of this.patterns) {
      const match = entry.regex.exec(source); if (!match) continue;
      const values = []; entry.fields.forEach((field, index) => { values[field] = literal(match[index + 1]); });
      return this.translate(entry.source, values);
    }
    return source;
  }
  translate(source, values = []) {
    const message = this.locale === 'en' ? this.catalog[source] ?? source : source;
    return message.replace(/\{(\w+)\}/g, (_, index) => this.resolve(values[index]));
  }
  setLocale(locale) {
    if (!LANGUAGES.includes(locale)) return false;
    // Any manual choice is saved, even one matching the detected language, so it outlives later browser changes.
    try { this.storage()?.setItem(LANGUAGE_KEY, locale); } catch { /* Session preference still applies. */ }
    if (locale === this.locale) return true;
    this.locale = locale; this.revision++;
    this.updateDocument();
    for (const ref of this.references) {
      const node = ref.deref(); if (!node) { this.references.delete(ref); continue; }
      this.render(node, this.nodes.get(node));
    }
    this.dispatchEvent(new Event('change')); return true;
  }
  updateDocument() {
    if (!globalThis.document?.documentElement) return;
    document.documentElement.lang = this.locale === 'en' ? 'en' : 'zh-CN';
    document.documentElement.dataset.language = this.locale;
  }
  record(node) {
    let record = this.nodes.get(node);
    if (!record) { record = { attrs: new Map() }; this.nodes.set(node, record); this.references.add(new WeakRef(node)); }
    return record;
  }
  render(node, record) {
    if (!record) return;
    if (record.text !== undefined) {
      const target = record.textNode || node;
      if (!record.textNode || target.parentNode === node) {
        const next = this.resolve(record.text); if (target.textContent !== next) target.textContent = next;
      }
    }
    for (const [name, value] of record.attrs) {
      const next = this.resolve(value); if (node.getAttribute?.(name) !== next) node.setAttribute(name, next);
    }
  }
  text(node, value) {
    const record = this.record(node); record.text = value;
    if (node.nodeType === 1 && globalThis.document?.createTextNode && record.textNode?.parentNode !== node) {
      record.textNode = document.createTextNode(''); node.replaceChildren(record.textNode);
    }
    this.render(node, record);
  }
  attr(node, name, value) { const record = this.record(node); record.attrs.set(name, value); this.render(node, record); }
  /** Only call for application-authored markup, never a subtree containing user names or input values. */
  markup(root) {
    if (!globalThis.document?.createTreeWalker || !root) return;
    const walker = document.createTreeWalker(root, 4); const texts = []; let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest('script,style,code,[data-l10n-literal]')) continue;
      if (han(node.textContent)) texts.push(node);
    }
    for (const text of texts) {
      const source = text.textContent, trimmed = source.trim();
      if (!trimmed) continue;
      this.text(text, source === trimmed ? source : format('{0}{1}{2}', literal(source.slice(0, source.indexOf(trimmed))), trimmed, literal(source.slice(source.indexOf(trimmed) + trimmed.length))));
    }
    const elements = [...(root.querySelectorAll?.('[aria-label],[title],[placeholder],[alt]') || [])];
    if (root.nodeType === 1) elements.push(root);
    for (const element of elements) for (const name of ['aria-label', 'title', 'placeholder', 'alt']) {
      const value = element.getAttribute(name); if (value && han(value)) this.attr(element, name, value);
    }
  }
}

export const i18n = new Localization();
export const t = (source, ...values) => values.length ? i18n.translate(source, values) : i18n.resolve(source);
export const localizedText = (node, value) => i18n.text(node, value);
export const localizedAttr = (node, name, value) => i18n.attr(node, name, value);
export const localizedNode = value => { const node = document.createTextNode(''); i18n.text(node, value); return node; };
export const localizeMarkup = root => i18n.markup(root);
i18n.updateDocument();
if (globalThis.document?.createTreeWalker) i18n.markup(document);
