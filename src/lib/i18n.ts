import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "@/i18n/en";

/**
 * English-only build (Zaino fork): the zh locale, the stored language
 * preference and the settings language picker are gone. One language means
 * no fallback chains, no sync drift, no per-render language lookups.
 */
i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

document.documentElement.lang = "en";

export default i18n;
