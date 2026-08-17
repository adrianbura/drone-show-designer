/**
 * Language context. Deliberately SEPARATE from the studio store so switching
 * language never invalidates project state, memoised engine results or the
 * Three.js scene graph — only text-rendering components re-render.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { TranslationKey } from "./en";
import {
  DEFAULT_LANGUAGE,
  readStoredLanguage,
  translate,
  writeStoredLanguage,
  type Language,
  type TranslationValues,
} from "./translate";

export interface I18nApi {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey | string, values?: TranslationValues) => string;
}

// Module reloads (HMR) must share one context instance, as in the studio store.
const GLOBAL_KEY = "__dssI18nContext";
const globalStore = globalThis as unknown as Record<string, React.Context<I18nApi | null>>;
const I18nContext: React.Context<I18nApi | null> =
  globalStore[GLOBAL_KEY] ?? createContext<I18nApi | null>(null);
globalStore[GLOBAL_KEY] = I18nContext;

export function I18nProvider({ children }: { children: ReactNode }) {
  // SSR renders the default locale; the stored preference is applied on mount.
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);

  useEffect(() => {
    const stored = readStoredLanguage();
    if (stored !== language) setLanguageState(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    writeStoredLanguage(next);
  }, []);

  const value = useMemo<I18nApi>(
    () => ({
      language,
      setLanguage,
      t: (key, values) => translate(language, key, values),
    }),
    [language, setLanguage],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nApi {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
