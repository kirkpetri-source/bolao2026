export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
          950: '#052e16',
        },
        gold: {
          50:  '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
        },
        pitch: {
          500: '#0f4d2a',
          600: '#0a3d22',
          700: '#082e1a',
          800: '#061f12',
          900: '#030f09',
          950: '#010705',
        },
      },
      fontFamily: {
        display: ['Syne', 'sans-serif'],
        body:    ['"DM Sans"', 'sans-serif'],
        stats:   ['"Barlow Condensed"', 'sans-serif'],
      },
      keyframes: {
        'slide-up': {
          '0%':   { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'bounce-in': {
          '0%':   { opacity: '0', transform: 'scale(0.85)' },
          '60%':  { opacity: '1', transform: 'scale(1.06)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition:  '200% 0' },
        },
        'pulse-dot': {
          '0%, 100%': { opacity: '1',   transform: 'scale(1)'   },
          '50%':       { opacity: '0.4', transform: 'scale(1.4)' },
        },
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 10px rgba(22,163,74,0.25)' },
          '50%':       { boxShadow: '0 0 22px rgba(22,163,74,0.55)' },
        },
      },
      animation: {
        'slide-up':   'slide-up 0.3s ease-out both',
        'fade-in':    'fade-in 0.25s ease-out both',
        'bounce-in':  'bounce-in 0.4s ease-out both',
        shimmer:      'shimmer 1.6s ease-in-out infinite',
        'pulse-dot':  'pulse-dot 1.6s ease-in-out infinite',
        'glow-pulse': 'glow-pulse 2.2s ease-in-out infinite',
      },
      boxShadow: {
        card:          '0 1px 4px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)',
        modal:         '0 24px 64px rgba(0,0,0,0.35)',
        button:        '0 4px 12px rgba(22,163,74,0.32)',
        'button-gold': '0 4px 12px rgba(245,158,11,0.38)',
        glow:          '0 0 20px rgba(22,163,74,0.28)',
        'glow-gold':   '0 0 20px rgba(245,158,11,0.32)',
        glass:         '0 8px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.1)',
      },
      borderRadius: {
        pill: '9999px',
      },
    },
  },
  plugins: [],
}
