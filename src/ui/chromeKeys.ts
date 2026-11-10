/** Platform-aware modifier labels shared by the top bar, the status bar and the shortcuts dialog. */

interface NavigatorLike {
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string };
}

/** True on macOS / iOS, where shortcuts are shown with the Command sign instead of Ctrl. */
export function detectMac(
  nav: NavigatorLike | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): boolean {
  if (!nav) return false;
  const platform = nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent ?? '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export function modKeyLabel(mac: boolean): string {
  return mac ? '⌘' : 'Ctrl';
}

export function shiftKeyLabel(mac: boolean): string {
  return mac ? '⇧' : 'Shift';
}

/** Mac glues keys together («⌘Z»); other platforms use plus signs («Ctrl+Z»). */
export function joinShortcut(mac: boolean, ...keys: string[]): string {
  return mac ? keys.join('') : keys.join('+');
}

/** Shortcut with the platform modifier first: `modShortcut(mac, 'Z')` gives «⌘Z» or «Ctrl+Z». */
export function modShortcut(mac: boolean, ...keys: string[]): string {
  return joinShortcut(mac, modKeyLabel(mac), ...keys);
}
