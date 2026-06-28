import { useStore } from '../state/store';
import { BlueCaffeLogo } from './BlueCaffeLogo';

// The screen BlueCaffe opens on: one viewport that says what the editor is and
// gets out of the way. "Open BlueCaffe" goes to the project launcher; the quiet
// link drops straight into the last project. Plain copy, one accent, no chrome.

const FEATURES: { title: string; body: string }[] = [
  {
    title: 'GPU compositor',
    body: 'WebGPU renders every frame on the graphics card. Canvas2D fallback when WebGPU is unavailable.',
  },
  {
    title: 'Timeline',
    body: 'Video, audio, and title tracks. Trim, split, and snap clips; they ripple on overlap.',
  },
  {
    title: 'Grade and animate',
    body: 'Color filters, push transitions, and keyframes for scale, position, and opacity per clip.',
  },
];

export function LandingPage() {
  const setView = useStore((s) => s.setView);
  const startTutorial = useStore((s) => s.startTutorial);

  const openTutorial = () => {
    setView('editor');
    // Defer so the editor has one frame to mount before the overlay measures elements.
    setTimeout(startTutorial, 80);
  };

  return (
    <div className="landing">
      <main className="lp-hero">
        <div className="lp-brandmark">
          <BlueCaffeLogo size={30} />
          <span>BlueCaffe</span>
        </div>
        <h1 className="lp-title">A video editor that runs in the browser.</h1>
        <div className="lp-cta">
          <button className="btn primary lp-go" onClick={() => setView('home')}>
            Open BlueCaffe
          </button>
          <button className="lp-link" onClick={() => setView('editor')}>
            Open last project
          </button>
        </div>
        <button className="lp-tutorial-btn" onClick={openTutorial}>
          <span className="lp-tutorial-ico" aria-hidden>▶</span>
          Interactive tutorial
        </button>
      </main>

      <section className="lp-features">
        {FEATURES.map((f) => (
          <div className="lp-feat" key={f.title}>
            <div className="lp-feat-title">{f.title}</div>
            <p className="lp-feat-body">{f.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
