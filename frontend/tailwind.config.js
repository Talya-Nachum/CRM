/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#dbe7fe',
          400: '#5b8def',
          500: '#3466e0',
          600: '#264fc4',
        },
      },
      fontFamily: {
        sans: ['"Segoe UI"', 'Tahoma', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
