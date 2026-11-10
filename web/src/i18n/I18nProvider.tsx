import { useMemo, type ReactNode } from 'react';
import { I18nContext } from './context';
import { STRINGS, type Lang } from './strings';

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  const value = useMemo(() => ({ lang, t: STRINGS[lang] }), [lang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
