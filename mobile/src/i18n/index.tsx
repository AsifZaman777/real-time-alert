import React, { createContext, useCallback, useContext, useState } from "react";
import { en, TranslationKeys } from "./locales/en";
import { bn } from "./locales/bn";

export type AppLanguage = "en" | "bn";

const DICTIONARIES: Record<AppLanguage, Record<TranslationKeys, string>> = {
  en,
  bn,
};

const EVENT_LABELS: Record<AppLanguage, Record<string, string>> = {
  en: {
    blockade: "Blockade",
    strike: "Strike",
    protest: "Protest",
    clash: "Clash",
    gunfire: "Gunfire",
    arson: "Arson",
    fire: "Fire",
    traffic_jam: "Traffic Jam",
    accident: "Accident",
    waterlogging: "Flooding",
    murder: "Homicide",
    robbery: "Robbery",
    explosion: "Explosion",
    crowd_surge: "Crowd Surge",
  },
  bn: {
    blockade: "অবরোধ",
    strike: "হরতাল / ধর্মঘট",
    protest: "বিক্ষোভ",
    clash: "সংঘর্ষ",
    gunfire: "গোলাগুলি",
    arson: "অগ্নিসংযোগ",
    fire: "অগ্নিকাণ্ড",
    traffic_jam: "তীব্র যানজট",
    accident: "দুর্ঘটনা",
    waterlogging: "জলাবদ্ধতা",
    murder: "হত্যাকাণ্ড",
    robbery: "ছিনতাই / ডাকাতি",
    explosion: "বিস্ফোরণ",
    crowd_surge: "ঘন ভিড়",
  },
};

const SEVERITY_LABELS: Record<AppLanguage, Record<string, string>> = {
  en: { CRITICAL: "CRITICAL", HIGH: "HIGH", MODERATE: "MODERATE" },
  bn: { CRITICAL: "জরুরি", HIGH: "উচ্চ", MODERATE: "মাঝারি" },
};

interface I18nContextValue {
  lang: AppLanguage;
  setLang: (next: AppLanguage) => void;
  toggleLang: () => void;
  t: (key: TranslationKeys, params?: Record<string, string | number>) => string;
  tEvent: (eventType: string) => string;
  tSeverity: (severity: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [lang, setLang] = useState<AppLanguage>("en");

  const toggleLang = useCallback(() => {
    setLang((prev) => (prev === "en" ? "bn" : "en"));
  }, []);

  const t = useCallback(
    (key: TranslationKeys, params?: Record<string, string | number>) => {
      let text = DICTIONARIES[lang]?.[key] ?? DICTIONARIES.en[key] ?? key;
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
        });
      }
      return text;
    },
    [lang]
  );

  const tEvent = useCallback(
    (eventType: string) => {
      const k = String(eventType || "").toLowerCase().trim();
      return (
        EVENT_LABELS[lang]?.[k] ||
        EVENT_LABELS.en[k] ||
        k.replace(/_/g, " ").toUpperCase()
      );
    },
    [lang]
  );

  const tSeverity = useCallback(
    (severity: string) => {
      const k = String(severity || "").toUpperCase().trim();
      return SEVERITY_LABELS[lang]?.[k] || k;
    },
    [lang]
  );

  return (
    <I18nContext.Provider
      value={{ lang, setLang, toggleLang, t, tEvent, tSeverity }}
    >
      {children}
    </I18nContext.Provider>
  );
};

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return ctx;
}
