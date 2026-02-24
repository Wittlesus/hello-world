import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Theme {
  id: string;
  name: string;
  accent: string;
  bg: string;
  surface: string;
  border: string;
  buddyIdle: string;    // waiting state color
  buddyActive: string;  // responding state color
}

export const THEMES: Theme[] = [
  // --- originals (IDs stable — persisted in localStorage) ---
  { id: 'void-protocol',   name: 'Void Protocol',    accent: '#60a5fa', bg: '#0a0a0f', surface: '#0f0f18', border: '#1e1e2e', buddyIdle: '#60a5fa', buddyActive: '#4ade80' },
  { id: 'neon-bonsai',     name: 'Neon Bonsai',      accent: '#4ade80', bg: '#071207', surface: '#0a190a', border: '#1a2e1a', buddyIdle: '#4ade80', buddyActive: '#22d3ee' },
  { id: 'solar-flare',     name: 'Solar Flare',      accent: '#fb923c', bg: '#100b00', surface: '#1c1300', border: '#2e2000', buddyIdle: '#60a5fa', buddyActive: '#fb923c' },
  { id: 'ghost-protocol',  name: 'Ghost Protocol',   accent: '#cbd5e1', bg: '#09090d', surface: '#111118', border: '#252535', buddyIdle: '#94a3b8', buddyActive: '#e2e8f0' },
  { id: 'infrared',        name: 'Infrared',         accent: '#f87171', bg: '#0f0505', surface: '#1a0808', border: '#2e1010', buddyIdle: '#f87171', buddyActive: '#fb923c' },
  { id: 'aquifer',         name: 'Aquifer',          accent: '#22d3ee', bg: '#020d10', surface: '#071519', border: '#0e2a2f', buddyIdle: '#22d3ee', buddyActive: '#4ade80' },
  { id: 'ember',           name: 'Ember',            accent: '#fbbf24', bg: '#100e00', surface: '#1c1a00', border: '#2e2a00', buddyIdle: '#fbbf24', buddyActive: '#fb923c' },

  // --- new themes ---
  { id: 'deep-violet',     name: 'Deep Violet',      accent: '#a78bfa', bg: '#080610', surface: '#100e1c', border: '#1e1a30', buddyIdle: '#a78bfa', buddyActive: '#c084fc' },
  { id: 'radioactive',     name: 'Radioactive',      accent: '#a3e635', bg: '#050a00', surface: '#0a1200', border: '#162100', buddyIdle: '#a3e635', buddyActive: '#4ade80' },
  { id: 'candy-shop',      name: 'Candy Shop',       accent: '#f472b6', bg: '#0f0410', surface: '#1a081c', border: '#2e1030', buddyIdle: '#f472b6', buddyActive: '#c084fc' },
  { id: 'deep-sea',        name: 'Deep Sea',         accent: '#38bdf8', bg: '#020810', surface: '#051218', border: '#0a2030', buddyIdle: '#38bdf8', buddyActive: '#34d399' },
  { id: 'lava-lamp',       name: 'Lava Lamp',        accent: '#ff6b35', bg: '#0f0600', surface: '#1c0e00', border: '#301800', buddyIdle: '#ff6b35', buddyActive: '#fbbf24' },
  { id: 'northern-lights', name: 'Northern Lights',  accent: '#6ee7b7', bg: '#020e0a', surface: '#061810', border: '#0e2a1c', buddyIdle: '#6ee7b7', buddyActive: '#38bdf8' },
  { id: 'bone',            name: 'Bone',             accent: '#d6cfc4', bg: '#0a0905', surface: '#141208', border: '#282415', buddyIdle: '#d6cfc4', buddyActive: '#fbbf24' },
];

interface ThemeState {
  themeId: string;
  setTheme: (id: string) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      themeId: 'void-protocol',
      setTheme: (id) => set({ themeId: id }),
    }),
    { name: 'hw-theme' }
  )
);

export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
