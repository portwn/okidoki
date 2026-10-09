import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { fetchJSON } from '../api';
import en from './en';
import ru from './ru';

const CATALOGS = { en, ru };
const DEFAULT_LANG = 'ru';

// Current language is mirrored at module scope so non-React helpers
// (e.g. date formatting) can pick the right locale. Set by the provider.
let currentLang = DEFAULT_LANG;

export function getLocale() {
    return currentLang === 'en' ? 'en-US' : 'ru-RU';
}

// Non-React translation using the current language (for plain helper functions).
export function translate(key, vars) {
    const catalog = CATALOGS[currentLang] || CATALOGS[DEFAULT_LANG];
    const text = catalog[key];
    return text === undefined ? key : interpolate(text, vars);
}

function interpolate(text, vars) {
    if (!vars) return text;
    return Object.entries(vars).reduce(
        (acc, [key, value]) => acc.replaceAll(`{${key}}`, String(value)),
        text
    );
}

const I18nContext = createContext({ lang: DEFAULT_LANG, t: (key) => key });

export function I18nProvider({ children }) {
    const [lang, setLang] = useState(DEFAULT_LANG);

    useEffect(() => {
        let active = true;
        fetchJSON('/api/config')
            .then((config) => {
                if (active && (config?.lang === 'en' || config?.lang === 'ru')) {
                    currentLang = config.lang;
                    setLang(config.lang);
                }
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, []);

    const catalog = CATALOGS[lang] || CATALOGS[DEFAULT_LANG];
    const t = useCallback((key, vars) => {
        const text = catalog[key];
        return text === undefined ? key : interpolate(text, vars);
    }, [catalog]);

    return <I18nContext.Provider value={{ lang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
    return useContext(I18nContext);
}
