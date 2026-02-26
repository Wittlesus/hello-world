import { getCurrentWindow } from '@tauri-apps/api/window';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { BuddyOverlay } from './components/BuddyOverlay.js';
import './styles.css';

const root = document.getElementById('root')!;

let isBuddy = false;
try {
  isBuddy = getCurrentWindow().label === 'buddy';
} catch {
  // fallback: render main app
}

if (isBuddy) {
  createRoot(root).render(
    <StrictMode>
      <BuddyOverlay />
    </StrictMode>,
  );
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
