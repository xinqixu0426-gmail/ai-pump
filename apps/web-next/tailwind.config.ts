import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: '#111827',
        muted: '#667085',
        line: '#e5e7eb',
        canvas: '#f7f8fa',
      },
      boxShadow: {
        panel: '0 1px 2px rgba(16, 24, 40, 0.06)',
      },
      borderRadius: {
        panel: '8px',
      },
    },
  },
  plugins: [],
};

export default config;
