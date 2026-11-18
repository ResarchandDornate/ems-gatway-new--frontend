import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand ramp (static — same in both themes).
        // Cyan-teal: identity only. This ramp dresses the logo mark and nothing
        // else — data and state use the `accent` token, which is theme-aware.
        // Mid stops (300–500) are deliberately mid-luminance so a single value
        // carries on both the deep-navy and the paper background.
        brand: {
          50:  "#E8F8FB",
          100: "#C4EDF4",
          200: "#8FDDEA",
          300: "#5ACBDE",
          400: "#2CC9DE",
          500: "#1B9BB4",
          600: "#14788C",
          700: "#0F5A6A",
        },

        // Semantic tokens via CSS variables — supports opacity modifiers
        bg:       "rgb(var(--color-bg) / <alpha-value>)",
        surface:  "rgb(var(--color-surface) / <alpha-value>)",
        surface2: "rgb(var(--color-surface2) / <alpha-value>)",
        surface3: "rgb(var(--color-surface3) / <alpha-value>)",
        line:     "rgb(var(--color-line) / <alpha-value>)",
        line2:    "rgb(var(--color-line2) / <alpha-value>)",
        ink:      "rgb(var(--color-ink) / <alpha-value>)",
        ink2:     "rgb(var(--color-ink2) / <alpha-value>)",
        ink3:     "rgb(var(--color-ink3) / <alpha-value>)",
        muted:    "rgb(var(--color-muted) / <alpha-value>)",
        muted2:   "rgb(var(--color-muted2) / <alpha-value>)",
        // Executive accent. Modules reference these rather than the brand ramp,
        // which is reserved for identity (the logo mark) and never for data.
        accent:   "rgb(var(--color-accent) / <alpha-value>)",
        accent2:  "rgb(var(--color-accent-2) / <alpha-value>)",
        good:     "rgb(var(--color-good) / <alpha-value>)",
        warn:     "rgb(var(--color-warn) / <alpha-value>)",
        bad:      "rgb(var(--color-bad) / <alpha-value>)",
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        // Soft glows
        "glow-brand":    "0 0 0 1px rgba(44,201,222,.15), 0 8px 32px -8px rgba(44,201,222,.28)",
        "glow-brand-sm": "0 0 0 1px rgba(44,201,222,.12), 0 0 14px rgba(44,201,222,.22)",
        "soft":          "0 2px 6px rgba(0,0,0,.18), 0 1px 2px rgba(0,0,0,.12)",
        // The elevation ladder, exposed to Tailwind so JSX can reach the same
        // three steps the CSS primitives use instead of inventing its own.
        "flat":          "var(--shadow-flat)",
        "raised":        "var(--shadow-raised)",
        "pop":           "var(--shadow-pop)",
      },
      borderRadius: {
        card:  "var(--r-card)",
        panel: "var(--r-panel)",
        tile:  "var(--r-tile)",
        ctl:   "var(--r-ctl)",
      },
      animation: {
        "pulse-soft": "pulse-soft 2.4s ease-in-out infinite",
        "fade-in":    "fade-in .4s ease-out",
      },
      keyframes: {
        "pulse-soft": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%":      { opacity: ".55", transform: "scale(1.15)" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to:   { opacity: "1", transform: "none" },
        },
      },
      backgroundImage: {
        "grid-faint": "radial-gradient(circle at 1px 1px, rgba(255,255,255,.025) 1px, transparent 0)",
      },
    },
  },
  plugins: [],
};

export default config;
