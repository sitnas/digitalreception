/**
 * Mortise brand marks, drawn as in the brand guidelines: three modules and Mo, the fourth one,
 * rotated by 8 degrees as it snaps into place. The geometry is fixed; only the two variants exist.
 *  - on light: black modules, yellow Mo;
 *  - on dark: yellow modules, white Mo.
 */
type Mood = 'happy' | 'wink' | 'surprised';

function Face({ mood }: { mood: Mood }) {
  return (
    <>
      <circle cx="-7.5" cy={mood === 'surprised' ? -5 : -4} r="3.4" fill="#0A0A0A" />
      {mood === 'wink'
        ? <path d="M4 -3.5 Q7.5 -8 11 -3.5" fill="none" stroke="#0A0A0A" strokeWidth="3.2" strokeLinecap="round" />
        : <circle cx="7.5" cy={mood === 'surprised' ? -5 : -4} r="3.4" fill="#0A0A0A" />}
      {mood === 'surprised'
        ? <ellipse cx="0" cy="8" rx="3.6" ry="4.4" fill="#0A0A0A" />
        : <path d="M-7 6 Q0 13.5 7 6" fill="none" stroke="#0A0A0A" strokeWidth="3.4" strokeLinecap="round" />}
    </>
  );
}

/** The symbol (modules + Mo). Decorative unless a label is given. */
export function MortiseMark({ size = 32, dark = false, label }: { size?: number; dark?: boolean; label?: string }) {
  const mod = dark ? '#FFD60A' : '#0A0A0A';
  const mo = dark ? '#FFFFFF' : '#FFD60A';
  return (
    <svg viewBox="0 0 104 104" width={size} height={size} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className="mortise-mark">
      <rect x="4" y="4" width="42" height="42" rx="12" fill={mod} />
      <rect x="54" y="4" width="42" height="42" rx="12" fill={mod} />
      <rect x="4" y="54" width="42" height="42" rx="12" fill={mod} />
      <g transform="translate(79 79) rotate(8)">
        <rect x="-21" y="-21" width="42" height="42" rx="12" fill={mo} />
        <Face mood="happy" />
      </g>
    </svg>
  );
}

/** Mo alone: where the user waits, explores or has just finished. Never on errors, payments or security. */
export function Mo({ size = 96, mood = 'happy', label }: { size?: number; mood?: Mood; label?: string }) {
  return (
    <svg viewBox="-34 -34 68 68" width={size} height={size} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className="mo">
      <g transform="rotate(8) scale(1.3)">
        <rect x="-21" y="-21" width="42" height="42" rx="12" fill="#FFD60A" />
        <Face mood={mood} />
      </g>
    </svg>
  );
}
