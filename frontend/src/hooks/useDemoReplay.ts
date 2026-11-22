import { useEffect, useState } from 'react';
import { useDemoState } from '@/hooks/useUi';
import manifest from '@/lib/demoManifest.json';

/* Visual replay clock for the guided demo. Returns 0..1 while the scene `id` is being narrated
   (it freezes while the demo is paused), or null when that scene is not active.
   Purely visual: it never calls the backend and never changes any data. */
export function useDemoReplay(id: string): number | null {
  const { demoScene, demoPlaying } = useDemoState();
  const active = demoScene === id;
  const ms = manifest.scenes.find((s) => s.id === id)?.ms ?? 10000;
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (active) setElapsed(0);
  }, [active]);
  useEffect(() => {
    if (!active || !demoPlaying) return;
    const t = window.setInterval(() => setElapsed((v) => v + 200), 200);
    return () => window.clearInterval(t);
  }, [active, demoPlaying]);
  return active ? Math.min(1, elapsed / ms) : null;
}
