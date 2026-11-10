// Audio input enumeration for the microphone picker. Browsers hide device
// ids and labels until the microphone permission is granted; then the list
// holds a single anonymous entry, which we report as `locked`.

/** The subset of MediaDevices the picker needs. */
export interface MediaDevicesLike {
  enumerateDevices(): Promise<Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label'>[]>;
  addEventListener(type: 'devicechange', listener: () => void): void;
  removeEventListener(type: 'devicechange', listener: () => void): void;
}

export interface AudioInput {
  deviceId: string;
  /** Empty when the browser hides labels. */
  label: string;
}

export interface AudioInputs {
  inputs: AudioInput[];
  /** True when inputs exist but the browser hides them (no permission yet). */
  locked: boolean;
}

/** `default` is Chrome's alias for the system default, which the picker offers itself. */
const ALIASES = new Set(['', 'default']);

export async function listAudioInputs(md: MediaDevicesLike): Promise<AudioInputs> {
  const all = (await md.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  const inputs = all
    .filter((d) => !ALIASES.has(d.deviceId))
    .map((d) => ({ deviceId: d.deviceId, label: d.label }));
  return { inputs, locked: all.length > 0 && all.every((d) => d.deviceId === '') };
}

/**
 * The device the picker should show for a saved id: the id itself when that
 * device is present, otherwise `''` (system default). While the list is
 * locked nothing can be checked, so the saved id is kept.
 */
export function resolveDeviceId(saved: string, list: AudioInputs): string {
  if (!saved || list.locked) return saved;
  return list.inputs.some((d) => d.deviceId === saved) ? saved : '';
}

const permissionListeners = new Set<() => void>();

/**
 * Tells the pickers that the microphone permission was just granted (a
 * `getUserMedia` call succeeded): the device names are visible now, but
 * browsers do not reliably fire `devicechange` for that.
 */
export function announceMicPermission(): void {
  permissionListeners.forEach((l) => l());
}

/** Calls `listener` after every `announceMicPermission`. Returns an unsubscribe. */
export function onMicPermission(listener: () => void): () => void {
  permissionListeners.add(listener);
  return () => void permissionListeners.delete(listener);
}

export function browserMediaDevices(): MediaDevicesLike | null {
  const md = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  return md && typeof md.enumerateDevices === 'function' ? md : null;
}
