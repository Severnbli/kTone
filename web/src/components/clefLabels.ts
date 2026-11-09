import type { ClefId } from '../engine/types';
import type { Strings } from '../i18n/strings';

/** UI string key for each clef name. */
export const CLEF_LABEL_KEY: Record<ClefId, keyof Strings> = {
  treble: 'clefTreble',
  treble8vb: 'clefTreble8vb',
  bass: 'clefBass',
  alto: 'clefAlto',
  tenor: 'clefTenor',
};
