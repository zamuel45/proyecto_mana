/* Logo de Maná: tres espigas de trigo sobre un sol de pan horneado */
export function Logo({ tam = 40, className }: { tam?: number; className?: string }) {
  return (
    <svg width={tam} height={tam} viewBox="0 0 100 100" className={className} role="img" aria-label="Maná">
      <defs>
        <radialGradient id="mana-sol" cx="38%" cy="32%" r="75%">
          <stop offset="0" stopColor="#f7b45a" />
          <stop offset="1" stopColor="#e07a1f" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="url(#mana-sol)" />
      <ellipse cx="50" cy="78" rx="27" ry="5" fill="#b85c12" opacity="0.55" />
      <path d="M33 77 C30 60 31 42 37 27 C40 40 41 58 39 77 Z" fill="#fff3dc" />
      <path d="M47 77 C45 56 46 36 50 18 C54 36 55 56 53 77 Z" fill="#fffaf0" />
      <path d="M61 77 C59 58 60 40 63 27 C69 42 70 60 67 77 Z" fill="#fff3dc" />
      <circle cx="37" cy="27" r="2.6" fill="#fffaf0" />
      <circle cx="50" cy="17" r="3" fill="#fffaf0" />
      <circle cx="63" cy="27" r="2.6" fill="#fffaf0" />
    </svg>
  );
}
