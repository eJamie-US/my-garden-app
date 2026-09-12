// src/i18n.ts
// Central i18next setup. Resources are plain JSON, one file per language
// under src/locales/ — adding a language later is "drop in one more file
// and add it to both maps below," no other code changes needed.
//
// First guess (before login, or for an account with no saved preference
// yet) comes from the BROWSER'S OWN language setting (navigator.language —
// a preference the person set in their browser/OS) via
// i18next-browser-languagedetector, deliberately NOT from IP/geolocation:
// someone's physical location says nothing reliable about which language
// they want (a Costa Rica-based English speaker should see English, and
// they will, since their browser is presumably set to English). A signed-in
// account's explicitly saved `user_settings.locale` always wins once it
// loads (via setAppLanguage, called from App.tsx), and Profile settings'
// language picker can always override either one by hand.

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import es from './locales/es.json';
import zh from './locales/zh.json';
import pt from './locales/pt.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import ja from './locales/ja.json';
import it from './locales/it.json';
import ko from './locales/ko.json';
import pl from './locales/pl.json';
import nl from './locales/nl.json';

/** code -> how that language names itself, for the picker in ProfileSettings —
 *  always shown in its own language, not translated into the viewer's current one. */
export const SUPPORTED_LOCALES: { code: string; nativeName: string }[] = [
  { code: 'en', nativeName: 'English' },
  { code: 'es', nativeName: 'Español' },
  { code: 'zh', nativeName: '中文' },
  { code: 'pt', nativeName: 'Português' },
  { code: 'fr', nativeName: 'Français' },
  { code: 'de', nativeName: 'Deutsch' },
  { code: 'ja', nativeName: '日本語' },
  { code: 'it', nativeName: 'Italiano' },
  { code: 'ko', nativeName: '한국어' },
  { code: 'pl', nativeName: 'Polski' },
  { code: 'nl', nativeName: 'Nederlands' },
];

const resources = {
  en: { translation: en },
  es: { translation: es },
  zh: { translation: zh },
  pt: { translation: pt },
  fr: { translation: fr },
  de: { translation: de },
  ja: { translation: ja },
  it: { translation: it },
  ko: { translation: ko },
  pl: { translation: pl },
  nl: { translation: nl },
};

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LOCALES.map((l) => l.code),
    // A browser reporting e.g. "en-US" or "es-MX" collapses to plain "en"/
    // "es" — every place that reads i18n.language (the plant-tips/AI-prompt
    // locale param, the DB's own locale column) expects a bare 2-letter code.
    load: 'languageOnly',
    interpolation: { escapeValue: false }, // React already escapes
    // Browser setting only — no IP/geolocation, no localStorage cache (the
    // account's own saved locale, once it loads, is the real store).
    detection: { order: ['navigator'], caches: [] },
  });

/** Called once a signed-in account's saved locale is known, so it overrides
 *  whatever the browser-language auto-detect guessed at first paint. */
export function setAppLanguage(code: string): void {
  if (code && code !== i18n.language) void i18n.changeLanguage(code);
}

export default i18n;
