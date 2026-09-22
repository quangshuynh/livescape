import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import './styles.css';
import './scenes/scenes.css';

const container = document.getElementById('livescape-root');
if (!container) {
  throw new Error('LiveScape renderer: #livescape-root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
