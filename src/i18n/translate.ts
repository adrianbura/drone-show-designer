/**
 * Pure translation layer. Lookup order: active locale -> English reference ->
 * the key itself. Interpolation uses `{name}` placeholders and never touches the
 * underlying numeric values.
 */
import { en, type Dictionary, type TranslationKey } from "./en";
import { ro } from "./ro";

export type Language = "en" | "ro";
export const LANGUAGES: readonly Language[] = ["en", "ro"];
export const DEFAULT_LANGUAGE: Language = "en";
export const LANGUAGE_STORAGE_KEY = "dss.language";

export const DICTIONARIES: Record<Language, Dictionary> = { en, ro };

export type TranslationValues = Record<string, string | number>;

export function interpolate(template: string, values?: TranslationValues): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

export function translate(
  language: Language,
  key: TranslationKey | string,
  values?: TranslationValues,
): string {
  const dict = DICTIONARIES[language] ?? en;
  const raw =
    (dict as Record<string, string>)[key] ?? (en as Record<string, string>)[key] ?? String(key);
  return interpolate(raw, values);
}

export function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "ro";
}

export function readStoredLanguage(): Language {
  try {
    const raw = globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(raw) ? raw : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export function writeStoredLanguage(language: Language): void {
  try {
    globalThis.localStorage?.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    /* persistence is a convenience; the session language still applies */
  }
}
