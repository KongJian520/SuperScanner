/**
 * Platform detection utility.
 * Works in both Tauri (desktop) and browser (web/mobile) environments.
 */

const ua = navigator.userAgent;
const platform = navigator.platform ?? '';

/** Running inside a Tauri native shell */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Mobile browser (Android or iOS) */
export const isAndroid = /Android/i.test(ua);
export const isIOS = /iPhone|iPad|iPod/i.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isMobile = isAndroid || isIOS;

/** Desktop OS — only meaningful when isTauri is true or running in desktop browser */
export const isMac = /Mac/i.test(platform) && !isIOS;
export const isWindows = /Win/i.test(platform);
export const isLinux = /Linux/i.test(platform) && !isAndroid;

/**
 * Current platform string for conditional rendering.
 * - 'tauri-mac'     → Tauri on macOS
 * - 'tauri-windows' → Tauri on Windows
 * - 'tauri-linux'   → Tauri on Linux
 * - 'android'       → Android browser / Tauri mobile
 * - 'ios'           → iOS browser / Tauri mobile
 * - 'web'           → Generic browser
 */
export type Platform = 'tauri-mac' | 'tauri-windows' | 'tauri-linux' | 'android' | 'ios' | 'web';

export const currentPlatform: Platform = (() => {
  if (isAndroid) return 'android';
  if (isIOS) return 'ios';
  if (isTauri) {
    if (isMac) return 'tauri-mac';
    if (isWindows) return 'tauri-windows';
    return 'tauri-linux';
  }
  return 'web';
})();
