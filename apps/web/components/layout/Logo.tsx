/**
 * The bitten-donut mark, inlined (not referenced as a static file) so its
 * outline can use `currentColor` and pick up `--text` automatically — a
 * fixed dark outline reads fine on the cream theme but disappears against
 * the dark theme's near-black background, since that background IS
 * essentially the same near-black tone. `app/icon.svg` keeps a
 * fixed-outline copy for the favicon, where that isn't a concern.
 */

const SPRINKLES = [
  { x: 68, y: 66, width: 20, fill: '#ffffff', rotate: 'rotate(24 78 69.5)' },
  { x: 122, y: 86, width: 20, fill: '#2dd4bf', rotate: 'rotate(-18 132 89.5)' },
  { x: 60, y: 108, width: 20, fill: '#5ec8f2', rotate: 'rotate(-32 70 111.5)' },
  { x: 96, y: 140, width: 20, fill: '#ffffff', rotate: 'rotate(10 106 143.5)' },
  { x: 132, y: 122, width: 20, fill: '#c77dff', rotate: 'rotate(48 142 125.5)' },
  { x: 78, y: 132, width: 18, fill: '#2dd4bf', rotate: 'rotate(-6 87 135.5)' },
  { x: 52, y: 86, width: 18, fill: '#ffe066', rotate: 'rotate(70 61 89.5)' },
] as const;

export function Logo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" role="img" aria-label="BiteDrop" className={className}>
      <defs>
        <mask id="bite-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200">
          <rect x="0" y="0" width="200" height="200" fill="#fff" />
          <circle cx="161" cy="27" r="28" fill="#000" />
        </mask>
      </defs>

      <g mask="url(#bite-mask)">
        <path
          fillRule="evenodd"
          d="M100,20 a80,80 0 1,0 0.1,0 Z M100,70 a30,30 0 1,1 -0.1,0 Z"
          fill="#e8a951"
          stroke="currentColor"
          strokeWidth="10"
          strokeLinejoin="round"
        />
        <path
          fillRule="evenodd"
          d="M100,32 a68,68 0 1,0 0.1,0 Z M100,68 a32,32 0 1,1 -0.1,0 Z"
          fill="#ff4fa3"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinejoin="round"
        />

        {SPRINKLES.map((sprinkle) => (
          <rect
            key={`${sprinkle.x}-${sprinkle.y}`}
            x={sprinkle.x}
            y={sprinkle.y}
            width={sprinkle.width}
            height={7}
            rx={3.5}
            fill={sprinkle.fill}
            transform={sprinkle.rotate}
          />
        ))}
      </g>

      <g fill="#ffc72c" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <path d="M164,4 L169,17 L182,20 L169,23 L164,36 L159,23 L146,20 L159,17 Z" />
        <path d="M189,32 L192,41 L200,44 L192,47 L189,56 L186,47 L178,44 L186,41 Z" />
      </g>
    </svg>
  );
}
