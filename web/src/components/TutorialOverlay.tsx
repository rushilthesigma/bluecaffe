import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';

interface Step {
  title: string;
  body: string;
  // CSS selector of the element to spotlight. Null = centred card, no dim.
  target: string | null;
  // Which side of the target to place the card on.
  side?: 'top' | 'bottom' | 'left' | 'right';
}

const STEPS: Step[] = [
  {
    title: 'Welcome to BlueCaffe',
    body: 'This quick tour shows you the core parts of the editor. Use the arrows to move between steps, or press Escape to exit.',
    target: null,
  },
  {
    title: 'Media Library',
    body: 'The library panel holds your project\'s assets. Click + Import to bring in video, images, or audio — or switch to Titles and Transitions for built-in resources.',
    target: '.library',
    side: 'right',
  },
  {
    title: 'Timeline',
    body: 'Drag clips from the library onto a track. Grab an edge to trim. Right-click for split, duplicate, and loop. The playhead scrubs to any frame.',
    target: '.panel.timeline',
    side: 'top',
  },
  {
    title: 'Preview',
    body: 'Every frame is composited on your GPU in real time. Hit play or drag the ruler to scrub. The snapshot button exports the current frame as a PNG.',
    target: '.panel.preview',
    side: 'bottom',
  },
  {
    title: 'Inspector',
    body: 'Select a clip on the timeline to edit it here. Adjust scale, position, opacity, colour grade, transitions, fades, and per-property keyframes — all with live preview.',
    target: '.panel.rightdock',
    side: 'left',
  },
  {
    title: 'Export',
    body: 'When your cut is ready, click Export to render the full project to an MP4 at your chosen resolution and frame rate.',
    target: '.export-btn',
    side: 'bottom',
  },
];

const PAD = 12; // spotlight padding around the target (px)

interface Rect { x: number; y: number; w: number; h: number }

function measure(selector: string): Rect | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
}

function cardPosition(side: Step['side'], spotlight: Rect, vw: number, vh: number) {
  const CARD_W = 320;
  const GAP = 14;
  switch (side) {
    case 'right':
      return {
        left: Math.min(spotlight.x + spotlight.w + GAP, vw - CARD_W - 16),
        top: spotlight.y + spotlight.h / 2,
        transform: 'translateY(-50%)',
      };
    case 'left':
      return {
        left: Math.max(16, spotlight.x - CARD_W - GAP),
        top: spotlight.y + spotlight.h / 2,
        transform: 'translateY(-50%)',
      };
    case 'top':
      return {
        left: Math.min(Math.max(16, spotlight.x), vw - CARD_W - 16),
        top: Math.max(8, spotlight.y - GAP),
        transform: 'translateY(-100%)',
      };
    case 'bottom':
    default:
      return {
        left: Math.min(Math.max(16, spotlight.x), vw - CARD_W - 16),
        top: spotlight.y + spotlight.h + GAP,
        transform: 'none',
      };
  }
}

export function TutorialOverlay() {
  const step = useStore((s) => s.tutorialStep);
  const advance = useStore((s) => s.advanceTutorial);
  const retreat = useStore((s) => s.retreatTutorial);
  const end = useStore((s) => s.endTutorial);

  const [spotlight, setSpotlight] = useState<Rect | null>(null);
  const [vw, setVw] = useState(window.innerWidth);
  const [vh, setVh] = useState(window.innerHeight);
  const rafRef = useRef<number>(0);

  const current = step !== null && step < STEPS.length ? STEPS[step] : null;

  // Continuously track the target element's position (it may resize/reflow).
  useEffect(() => {
    if (!current?.target) {
      setSpotlight(null);
      return;
    }
    const tick = () => {
      setSpotlight(measure(current.target!));
      setVw(window.innerWidth);
      setVh(window.innerHeight);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [current?.target]);

  // Keyboard: right/left arrows + Escape.
  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') advance();
      else if (e.key === 'ArrowLeft') retreat();
      else if (e.key === 'Escape') end();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, advance, retreat, end]);

  if (step === null || !current) return null;

  const isLast = step === STEPS.length - 1;
  const pos = spotlight
    ? cardPosition(current.side, spotlight, vw, vh)
    : { left: vw / 2, top: vh / 2, transform: 'translate(-50%, -50%)' };

  return (
    <div className="tut-root">
      {/* dim + spotlight cutout */}
      <svg className="tut-svg" aria-hidden>
        <defs>
          <mask id="tut-mask">
            <rect width="100%" height="100%" fill="white" />
            {spotlight && (
              <rect
                x={spotlight.x}
                y={spotlight.y}
                width={spotlight.w}
                height={spotlight.h}
                rx={8}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill={spotlight ? 'rgba(0,0,0,0.72)' : 'rgba(0,0,0,0.5)'}
          mask="url(#tut-mask)"
        />
        {/* highlight ring around the target */}
        {spotlight && (
          <rect
            x={spotlight.x}
            y={spotlight.y}
            width={spotlight.w}
            height={spotlight.h}
            rx={8}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={1.5}
            opacity={0.7}
          />
        )}
      </svg>

      {/* step card */}
      <div className="tut-card" style={{ left: pos.left, top: pos.top, transform: pos.transform }}>
        <div className="tut-progress">
          {STEPS.map((_, i) => (
            <span key={i} className={`tut-dot${i === step ? ' on' : i < step ? ' done' : ''}`} />
          ))}
        </div>
        <div className="tut-title">{current.title}</div>
        <p className="tut-body">{current.body}</p>
        <div className="tut-foot">
          <button className="tut-skip" onClick={end}>
            {isLast ? 'Close' : 'Skip tour'}
          </button>
          <div className="tut-nav">
            {step > 0 && (
              <button className="tut-btn tut-prev" onClick={retreat}>← Back</button>
            )}
            <button className="tut-btn tut-next" onClick={isLast ? end : advance}>
              {isLast ? 'Done' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
