// Misma paleta y tipografías que usaba el CDN de Tailwind en cada página.
module.exports = {
  content: ['./*.html', './indicadores.js'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#080D19', 900: '#0C1424', 800: '#121B2E', 700: '#1A2740', 600: '#243357' },
        mist: { 300: '#B7C3D9', 400: '#8FA0BE', 500: '#9AA9C4' },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
    },
  },
};
