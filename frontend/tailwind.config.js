/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'op-red': '#e63946',
        'op-blue': '#1d3557',
        'op-yellow': '#f4a261',
        'op-green': '#2a9d8f',
        'op-purple': '#7b2d8b',
        'op-black': '#1a1a2e',
      },
    },
  },
  plugins: [],
}
