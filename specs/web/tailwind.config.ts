import type { Config } from 'tailwindcss';

/**
 * Styling is token-driven. Components name **roles** — `bg-surface`, `text-muted`, `border-rule` —
 * never colours. The tokens themselves are CSS variables in `app/globals.css`, so a theme is data.
 *
 * A component that hardcodes a colour breaks the system for everything downstream and nothing will
 * warn you, so watch for it in review.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ground: 'rgb(var(--ground) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--ink-muted) / <alpha-value>)',
        faint: 'rgb(var(--ink-faint) / <alpha-value>)',
        rule: 'rgb(var(--rule) / <alpha-value>)',
        'rule-strong': 'rgb(var(--rule-strong) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-ink': 'rgb(var(--accent-ink) / <alpha-value>)',
        'accent-soft': 'rgb(var(--accent-soft) / <alpha-value>)',
        'accent-on': 'rgb(var(--accent-on) / <alpha-value>)',
        critical: 'rgb(var(--critical) / <alpha-value>)',
        'critical-soft': 'rgb(var(--critical-soft) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        'warning-soft': 'rgb(var(--warning-soft) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      fontSize: {
        // A tight scale. This is a record-keeping surface read at density, not a landing page.
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
        xs: ['0.75rem', { lineHeight: '1.1rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.9375rem', { lineHeight: '1.5rem' }],
        lg: ['1.125rem', { lineHeight: '1.6rem' }],
        xl: ['1.25rem', { lineHeight: '1.7rem' }],
        '2xl': ['1.5rem', { lineHeight: '1.85rem' }],
      },
      borderRadius: { DEFAULT: '4px', sm: '2px', md: '5px' },
      boxShadow: {
        card: '0 1px 2px rgb(20 32 27 / 0.05), 0 10px 30px -20px rgb(20 32 27 / 0.35)',
      },
    },
  },
  plugins: [],
};

export default config;
