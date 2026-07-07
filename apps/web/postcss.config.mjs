// Tailwind v4 CSS-first: no existe tailwind.config.js; el plugin de PostCSS
// procesa el @import 'tailwindcss' de globals.css (skill frontend).
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
