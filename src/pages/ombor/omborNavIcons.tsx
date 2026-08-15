// Hand-drawn line icons for OmborIconNav — this app has no icon library
// (confirmed before writing these: no lucide/heroicons/react-icons in
// package.json, zero icon-package imports anywhere in src/). Every existing
// small glyph in the app is either a bare Unicode character or, in exactly
// one place (AppNavShell.tsx's hamburger/close), a hand-written inline SVG —
// same style reused here: 24x24 viewBox, stroke="currentColor", no fill, so
// each icon inherits its NavLink's tone colour automatically.
const common = {
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: 'h-5 w-5',
}

// Skladga KIRIM — material entering the warehouse.
export function KirimIcon() {
  return (
    <svg {...common}>
      <path d="M12 4v13" />
      <path d="M6 12l6 6 6-6" />
    </svg>
  )
}

// Skladdan CHIQIM — material leaving the factory.
export function ChiqimIcon() {
  return (
    <svg {...common}>
      <path d="M12 20V7" />
      <path d="M6 12l6-6 6 6" />
    </svg>
  )
}

// Moykaga Chiqarish — sent to wash (droplet).
export function MoykaIcon() {
  return (
    <svg {...common}>
      <path d="M12 3c3.4 3.9 6 7.3 6 10.5a6 6 0 1 1-12 0C6 10.3 8.6 6.9 12 3z" />
    </svg>
  )
}

// Tayyor Mahsulot — finished, packed product.
export function TayyorIcon() {
  return (
    <svg {...common}>
      <path d="M3 8l9-4 9 4-9 4-9-4z" />
      <path d="M3 8v9l9 4 9-4V8" />
      <path d="M12 12v9" />
    </svg>
  )
}

// Hisobotlar — reports.
export function HisobotlarIcon() {
  return (
    <svg {...common}>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4" />
      <path d="M9.5 12h5M9.5 15.5h5" />
    </svg>
  )
}
