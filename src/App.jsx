import React, { useState } from 'react';
import OnlineReader from './components/OnlineReader.jsx';
import Welcome from './components/Welcome.jsx';
import { hasWelcomed } from './lib/i18n.js';

export default function App() {
  const [welcomed, setWelcomed] = useState(() => hasWelcomed());
  if (!welcomed) {
    return <Welcome onDone={() => setWelcomed(true)} />;
  }
  return <OnlineReader />;
}
