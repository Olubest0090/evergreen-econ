"use client";

/**
 * Optional page translation via Google Website Translator.
 * Default UI language remains English; picker lets members choose any listed language.
 */
import { useEffect, useState } from "react";

declare global {
  interface Window {
    googleTranslateElementInit?: () => void;
    google?: {
      translate: {
        TranslateElement: new (
          opts: { pageLanguage: string; autoDisplay: boolean },
          id: string
        ) => void;
      };
    };
  }
}

export default function LanguagePicker() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (document.getElementById("google-translate-script")) {
      setReady(true);
      return;
    }
    window.googleTranslateElementInit = () => {
      try {
        if (window.google?.translate?.TranslateElement) {
          new window.google.translate.TranslateElement(
            { pageLanguage: "en", autoDisplay: false },
            "google_translate_element"
          );
        }
      } catch {
        /* ignore */
      }
      setReady(true);
    };
    const s = document.createElement("script");
    s.id = "google-translate-script";
    s.src =
      "//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
    s.async = true;
    document.body.appendChild(s);
  }, []);

  return (
    <div className="flex flex-col items-center gap-1 text-xs text-[var(--muted)]">
      <span>Language</span>
      <div
        id="google_translate_element"
        className="min-h-[28px] rounded-lg border border-[var(--border)] bg-black/20 px-2 py-1"
      />
      {!ready && <span className="text-[10px]">Loading translator…</span>}
    </div>
  );
}
