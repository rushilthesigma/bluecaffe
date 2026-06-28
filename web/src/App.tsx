import { useEffect } from 'react';
import { useStore } from './state/store';
import { TopBar } from './components/TopBar';
import { Library } from './components/Library';
import { Preview } from './components/Preview';
import { Timeline } from './components/Timeline';
import { RightDock } from './components/RightDock';
import { ProjectViewer } from './components/ProjectViewer';
import { LandingPage } from './components/LandingPage';
import { TutorialOverlay } from './components/TutorialOverlay';

export function App() {
  const connect = useStore((s) => s.connect);
  const view = useStore((s) => s.view);

  useEffect(() => {
    // bootstrap from REST, then keep live over WS
    fetch('/api/state')
      .then((r) => r.json())
      .then((s) => useStore.getState().applyServer(s))
      .catch(() => {});
    connect();
  }, [connect]);

  // The landing page is the first surface; from there you open the launcher.
  if (view === 'landing') return <LandingPage />;
  // The project viewer is where you start: browse every project, then jump in.
  if (view === 'home') return <ProjectViewer />;

  return (
    <div className="app">
      <TopBar />
      <div className="workspace">
        <Library />
        <Preview />
        <RightDock />
      </div>
      <Timeline />
      <TutorialOverlay />
    </div>
  );
}
