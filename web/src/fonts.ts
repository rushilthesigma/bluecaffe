// Curated typefaces a title clip can be set in. The actual web fonts are pulled
// in by the Google Fonts <link> in index.html; this list, the CSS stacks, and
// the on-demand loader below keep the picker, the canvas rasterizer, and the
// on-stage measurement all in agreement about what each id renders as.

export interface FontDef {
  id: string;
  label: string;
  family: string | null; // CSS family name; null = use the OS system font
  stack: string;         // full font-family value with fallbacks
  cat: 'sans' | 'serif' | 'display' | 'script' | 'mono';
}

const SYSTEM_STACK = `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;

export const FONTS: FontDef[] = [
  { id: 'system',       label: 'System Sans',      family: null,               stack: SYSTEM_STACK,                      cat: 'sans' },
  { id: 'inter',        label: 'Inter',            family: 'Inter',            stack: `'Inter', ${SYSTEM_STACK}`,        cat: 'sans' },
  { id: 'montserrat',   label: 'Montserrat',       family: 'Montserrat',       stack: `'Montserrat', sans-serif`,        cat: 'sans' },
  { id: 'oswald',       label: 'Oswald',           family: 'Oswald',           stack: `'Oswald', sans-serif`,            cat: 'sans' },
  { id: 'bebas',        label: 'Bebas Neue',       family: 'Bebas Neue',       stack: `'Bebas Neue', sans-serif`,        cat: 'display' },
  { id: 'anton',        label: 'Anton',            family: 'Anton',            stack: `'Anton', sans-serif`,             cat: 'display' },
  { id: 'archivo-black',label: 'Archivo Black',    family: 'Archivo Black',    stack: `'Archivo Black', sans-serif`,     cat: 'display' },
  { id: 'playfair',     label: 'Playfair Display', family: 'Playfair Display', stack: `'Playfair Display', serif`,        cat: 'serif' },
  { id: 'lora',         label: 'Lora',             family: 'Lora',             stack: `'Lora', serif`,                   cat: 'serif' },
  { id: 'merriweather', label: 'Merriweather',     family: 'Merriweather',     stack: `'Merriweather', serif`,           cat: 'serif' },
  { id: 'pacifico',     label: 'Pacifico',         family: 'Pacifico',         stack: `'Pacifico', cursive`,             cat: 'script' },
  { id: 'caveat',       label: 'Caveat',           family: 'Caveat',           stack: `'Caveat', cursive`,               cat: 'script' },
  { id: 'lobster',      label: 'Lobster',          family: 'Lobster',          stack: `'Lobster', cursive`,              cat: 'script' },
  { id: 'jetbrains',    label: 'JetBrains Mono',   family: 'JetBrains Mono',   stack: `'JetBrains Mono', monospace`,     cat: 'mono' },
];

const BY_ID = new Map(FONTS.map((f) => [f.id, f]));

export function fontDef(id?: string | null): FontDef {
  return (id && BY_ID.get(id)) || FONTS[0];
}

// CSS font-family value (with fallbacks) for a saved font id.
export function fontStack(id?: string | null): string {
  return fontDef(id).stack;
}

// The canvas 2D API only paints a web font once it is actually loaded; until
// then it silently falls back to the default. We can't block, so we kick off a
// load and report readiness — the renderer folds this flag into its text cache
// signature so the layer re-paints automatically the frame the font arrives.
const requested = new Set<string>();
export function isFontReady(id?: string | null, weight = 700): boolean {
  const def = fontDef(id);
  if (!def.family) return true; // system font is always present
  if (typeof document === 'undefined' || !('fonts' in document)) return true;
  const spec = `${weight} 1em "${def.family}"`;
  try {
    if (document.fonts.check(spec)) return true;
    const key = `${weight}|${def.family}`;
    if (!requested.has(key)) {
      requested.add(key);
      document.fonts.load(spec).catch(() => {});
    }
    return false;
  } catch {
    return true; // be permissive if the Font Loading API misbehaves
  }
}
