/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0d0d0f',
        surface: '#1a1a1f',
        'surface-2': '#24242b',
        accent: '#22c55e',
        'text-primary': '#f5f5f5',
        'text-secondary': '#8b8b9e',
        'rating-green':  '#16a34a',
        'rating-lime':   '#65a30d',
        'rating-yellow': '#ca8a04',
        'rating-orange': '#ea580c',
        'rating-red':    '#dc2626',
      },
      fontFamily: {
        display: ['"Barlow Condensed"', 'sans-serif'],
        mono:    ['"DM Mono"', 'monospace'],
        body:    ['"DM Sans"', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
