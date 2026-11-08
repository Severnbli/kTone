import { createContext, useContext } from 'react';
import { STRINGS, type Lang, type Strings } from './strings';

export interface I18n {
  lang: Lang;
  t: Strings;
}

export const I18nContext = createContext<I18n>({ lang: 'ru', t: STRINGS.ru });

export function useI18n(): I18n {
  return useContext(I18nContext);
}
