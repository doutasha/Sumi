import React, { useState } from 'react';
import OnlineReader from './components/OnlineReader.jsx';
import Welcome from './components/Welcome.jsx';
import { hasWelcomed } from './lib/i18n.js';

export default function App() {
  const [welcomed, setWelcomed] = useState(() => hasWelcomed());
  const [tourPending, setTourPending] = useState(false);
  if (!welcomed) {
    return (
      <Welcome
        onDone={(opts) => {
          setWelcomed(true);
          if (opts?.tour) setTourPending(true);
        }}
      />
    );
  }
  return <OnlineReader startTour={tourPending} />;
}
