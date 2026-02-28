// ClaudeBuddy — thin shim kept for backwards compat.
// The visual buddy now lives in a separate alwaysOnTop Tauri window (BuddyOverlay).
// This component only emits theme-changed events so the buddy window stays in sync.

import { emit } from '@tauri-apps/api/event';
import { useEffect } from 'react';
import { useThemeStore } from '../stores/theme.js';

export function ClaudeBuddy() {
  const themeId = useThemeStore((s) => s.themeId);

  // Broadcast current theme whenever it changes so BuddyOverlay stays in sync
  useEffect(() => {
    emit('hw-theme-changed', themeId).catch(() => {});
  }, [themeId]);

  return null;
}
ClaudeBuddy.displayName = 'ClaudeBuddy';
