// Build-time values injected by `define` in vite.config.ts.
declare const __APP_VERSION__: string;
declare const __GIT_SHA__: string;

/** Package version from web/package.json, e.g. "0.1.0". */
export const APP_VERSION = __APP_VERSION__;
/** Short commit SHA of the build, or "dev" for local builds. */
export const GIT_SHA = __GIT_SHA__;

export const SOURCE_URL = 'https://github.com/Severnbli/kTone';
export const LICENSE_URL = `${SOURCE_URL}/blob/main/LICENSE`;
export const LICENSE_NAME = 'GPL-3.0';
