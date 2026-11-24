/** The Android app serves its packaged web assets from this local HTTPS origin. */
export function isAndroidApp(): boolean {
  return window.location.origin === 'https://appassets.androidplatform.net';
}
