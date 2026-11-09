import { useSyncExternalStore } from 'react';
import type { PitchStore } from '../audio/pitchStore';
import { useI18n } from '../i18n/context';

/** Shown while the microphone keeps hearing the drone (see `PitchStore.getDroneLeak`). */
export function DroneLeakHint({ store }: { store: PitchStore }) {
  const { t } = useI18n();
  const leak = useSyncExternalStore(store.subscribeDroneLeak, store.getDroneLeak);
  if (!leak) return null;
  return (
    <p className="toast warning" role="status" data-testid="drone-leak-hint">
      {t.droneLeak}
    </p>
  );
}
