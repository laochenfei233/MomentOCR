/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      // Apple Design: Custom font family
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Display',
          'SF Pro Text',
          'Helvetica Neue',
          'Segoe UI',
          'system-ui',
          'sans-serif',
        ],
      },
      // Apple Design: Custom colors
      colors: {
        blue: {
          50: '#f0f5ff',
          100: '#e0eaff',
          200: '#c7d7fe',
          300: '#a4bcfd',
          400: '#8098f9',
          500: '#6172f3',
          600: '#444ce7',
          700: '#3538cd',
          800: '#2d31a6',
          900: '#2b2f83',
          950: '#1a1b4b',
        },
      },
      // Apple Design: Custom shadows
      boxShadow: {
        'material': '0 2px 8px rgba(0, 0, 0, 0.08), 0 8px 32px rgba(0, 0, 0, 0.12)',
        'material-lg': '0 4px 16px rgba(0, 0, 0, 0.1), 0 16px 64px rgba(0, 0, 0, 0.16)',
      },
      // Apple Design: Custom animations
      animation: {
        'slide-up': 'slideUp 0.4s cubic-bezier(0.25, 0.1, 0.25, 1) forwards',
        'fade-in': 'fadeIn 0.3s ease-out forwards',
        'scale-in': 'scaleIn 0.2s cubic-bezier(0.25, 0.1, 0.25, 1) forwards',
      },
      keyframes: {
        slideUp: {
          '0%': { transform: 'translateY(12px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
      // Apple Design: Custom transitions
      transitionTimingFunction: {
        'spring': 'cubic-bezier(0.25, 0.1, 0.25, 1)',
        'bounce': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    },
  },
  plugins: [],
};
