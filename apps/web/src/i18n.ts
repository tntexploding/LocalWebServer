import enUS from './locales/en-US.json';
import zhCN from './locales/zh-CN.json';

/** A locale with a complete local dictionary. */
export type Locale = 'zh-CN' | 'en-US';

const dictionaries: Record<Locale, Record<string, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

/** Resolves a localized string and replaces named placeholders. */
export function translate(
  locale: Locale,
  key: string,
  values: Record<string, string | number> = {},
): string {
  const template =
    dictionaries[locale][key] ?? dictionaries['zh-CN'][key] ?? key;
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  );
}
