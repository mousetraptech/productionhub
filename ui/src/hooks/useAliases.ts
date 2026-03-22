import { useState, useEffect } from 'react';

const API = `${window.location.protocol}//${window.location.hostname}:8081`;

export function useAliases() {
  const [aliases, setAliases] = useState<Record<string, number[]>>({});

  useEffect(() => {
    fetch(`${API}/api/v1/aliases`)
      .then(r => r.ok ? r.json() : {})
      .then(setAliases)
      .catch(() => {});
  }, []);

  return aliases;
}
