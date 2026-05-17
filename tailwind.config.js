export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        campo: {
          50:  '#f0fdf5',
          100: '#dcfce9',
          200: '#bbf7d2',
          300: '#6ee7a5',
          400: '#34d375',
          500: '#10b957',
          600: '#008542',
          700: '#006e37',
          800: '#00572c',
          900: '#004522',
          950: '#002412',
        },
        ouro: {
          50:  '#fffde7',
          100: '#fff9c4',
          200: '#fff59d',
          300: '#fff176',
          400: '#ffee58',
          500: '#FFD700',
          600: '#f9a825',
          700: '#f57f17',
          800: '#e65100',
          900: '#bf360c',
        },
        noite: {
          50:  '#f5f7fa',
          100: '#e4e7ec',
          200: '#cdd2da',
          300: '#9aa3b0',
          400: '#68748a',
          500: '#4b5568',
          600: '#374151',
          700: '#1f2937',
          800: '#111827',
          900: '#0a0f1a',
          950: '#060912',
        },
        areia: {
          50:  '#fefcf7',
          100: '#fdf7ed',
          200: '#f9edd8',
          300: '#f3dbb2',
        },
        /* Keep v1 tokens for backward compat */
        brand: {
          50:'#f0fdf4',100:'#dcfce7',200:'#bbf7d0',300:'#86efac',400:'#4ade80',
          500:'#22c55e',600:'#16a34a',700:'#15803d',800:'#166534',900:'#14532d',950:'#052e16',
        },
        gold: {
          50:'#fffbeb',100:'#fef3c7',200:'#fde68a',300:'#fcd34d',400:'#fbbf24',
          500:'#f59e0b',600:'#d97706',700:'#b45309',800:'#92400e',900:'#78350f',
        },
        pitch: {
          500:'#0f4d2a',600:'#0a3d22',700:'#082e1a',800:'#061f12',900:'#030f09',950:'#010705',
        },
      },
      fontFamily: {
        display: ['"Bebas Neue"', 'cursive'],
        body:    ['Outfit', 'sans-serif'],
        stats:   ['"Bebas Neue"', 'cursive'],
      },
      letterSpacing: {
        widest2: '0.2em',
        widest3: '0.3em',
      },
      keyframes: {
        'slide-up': {
          '0%':   { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-right': {
          '0%':   { opacity: '0', transform: 'translateX(-16px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'fade-in': {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'bounce-in': {
          '0%':   { opacity: '0', transform: 'scale(0.88)' },
          '65%':  { opacity: '1', transform: 'scale(1.04)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition:  '200% 0' },
        },
        'pulse-dot': {
          '0%, 100%': { opacity: '1',   transform: 'scale(1)'   },
          '50%':       { opacity: '0.3', transform: 'scale(1.6)' },
        },
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 8px rgba(0,133,66,0.2)'  },
          '50%':       { boxShadow: '0 0 20px rgba(0,133,66,0.5)' },
        },
        'ticker': {
          '0%':   { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        'slide-up':   'slide-up 0.35s cubic-bezier(0.16,1,0.3,1) both',
        'slide-right':'slide-right 0.3s cubic-bezier(0.16,1,0.3,1) both',
        'fade-in':    'fade-in 0.25s ease-out both',
        'bounce-in':  'bounce-in 0.4s ease-out both',
        shimmer:      'shimmer 1.8s ease-in-out infinite',
        'pulse-dot':  'pulse-dot 1.8s ease-in-out infinite',
        'glow-pulse': 'glow-pulse 2.4s ease-in-out infinite',
        ticker:       'ticker 24s linear infinite',
      },
      boxShadow: {
        card:         '0 2px 12px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.04)',
        'card-hover': '0 8px 30px rgba(0,0,0,0.12)',
        modal:        '0 32px 80px rgba(0,0,0,0.4)',
        button:       '0 4px 14px rgba(0,133,66,0.35)',
        'button-ouro':'0 4px 14px rgba(255,215,0,0.4)',
        sidebar:      '4px 0 20px rgba(0,0,0,0.25)',
        glow:         '0 0 20px rgba(0,133,66,0.28)',
        'glow-gold':  '0 0 20px rgba(255,215,0,0.32)',
        /* v1 compat */
        glass:        '0 8px 40px rgba(0,0,0,0.45)',
        'glow-gold-v1':'0 0 20px rgba(245,158,11,0.32)',
      },
      borderRadius: {
        pill: '9999px',
        '2.5xl': '1.25rem',
      },
    },
  },
  plugins: [],
}
