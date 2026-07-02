// Theme system for ggboi Dashboard

import { useState, useCallback } from 'react';

const THEMES = {
  dark: { label: 'Dark', colors: {} },
  midnight: { label: 'Midnight', colors: {} },
  graphite: { label: 'Graphite', colors: {} },
  violet: { label: 'Violet', colors: {} },
  emerald: { label: 'Emerald', colors: {} },
};

const DENSITIES = {
  comfortable: { label: 'Comfortable', space: 1 },
  compact: { label: 'Compact', space: 0.85 },
  dense: { label: 'Dense', space: 0.7 },
};

const PANEL_STYLES = {
  flat: { label: 'Flat' },
  elevated: { label: 'Elevated' },
  glass: { label: 'Glass' },
  bordered: { label: 'Bordered' },
};

const MOTIONS = {
  full: { label: 'Full' },
  reduced: { label: 'Reduced' },
  off: { label: 'Off' },
};

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem('ggboi_dashboard_prefs') || '{}');
  } catch {
    return {};
  }
}

function savePrefs(prefs) {
  localStorage.setItem('ggboi_dashboard_prefs', JSON.stringify(prefs));
}

function applyTheme(theme, density, panelStyle, motion) {
  const root = document.documentElement;
  if (theme && theme !== 'dark') {
    root.setAttribute('data-theme', theme);
  } else {
    root.removeAttribute('data-theme');
  }

  root.style.setProperty('--density', DENSITIES[density]?.space ?? 1);

  if (panelStyle && panelStyle !== 'elevated') {
    root.setAttribute('data-panel', panelStyle);
  } else {
    root.removeAttribute('data-panel');
  }

  if (motion === 'reduced') {
    root.style.setProperty('--duration-fast', '0ms');
    root.style.setProperty('--duration-base', '0ms');
    root.style.setProperty('--duration-slow', '0ms');
  } else if (motion === 'off') {
    root.style.setProperty('--duration-fast', '0ms');
    root.style.setProperty('--duration-base', '0ms');
    root.style.setProperty('--duration-slow', '0ms');
  } else {
    root.style.removeProperty('--duration-fast');
    root.style.removeProperty('--duration-base');
    root.style.removeProperty('--duration-slow');
  }
}

export function initTheme() {
  const prefs = loadPrefs();
  applyTheme(prefs.theme, prefs.density, prefs.panelStyle, prefs.motion);
}

export function getThemePrefs() {
  return loadPrefs();
}

export function setThemePrefs(updates) {
  const prefs = { ...loadPrefs(), ...updates };
  savePrefs(prefs);
  applyTheme(prefs.theme, prefs.density, prefs.panelStyle, prefs.motion);
  return prefs;
}

export function getThemes() {
  return THEMES;
}

export function getDensities() {
  return DENSITIES;
}

export function getPanelStyles() {
  return PANEL_STYLES;
}

export function getMotions() {
  return MOTIONS;
}

export function useTheme() {
  const [prefs, setPrefs] = useState(() => loadPrefs());

  const update = useCallback((updates) => {
    const newPrefs = setThemePrefs(updates);
    setPrefs(newPrefs);
  }, []);

  return { prefs, update };
}
