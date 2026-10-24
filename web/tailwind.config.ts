import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        chrome: "var(--chrome)",
        surface: "var(--surface)",
        panel: "var(--panel)",
        hover: "var(--hover)",
        active: "var(--active)",
        line: "var(--border)",
        "line-strong": "var(--border-strong)",
        ink: "var(--ink)",
        ink2: "var(--ink2)",
        muted: "var(--muted)",
        faint: "var(--faint)",
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          weak: "var(--accent-weak)",
          ink: "var(--accent-ink)",
        },
        success: {
          DEFAULT: "var(--success)",
          weak: "var(--success-weak)",
        },
        warning: {
          DEFAULT: "var(--warning)",
          weak: "var(--warning-weak)",
        },
        danger: {
          DEFAULT: "var(--danger)",
          weak: "var(--danger-weak)",
        },
        info: "var(--info)",
      },
      // Amber text uses a deeper tone so it meets AA on paper in light mode.
      textColor: {
        accent: {
          DEFAULT: "var(--accent-text)",
          hover: "var(--accent-hover)",
          weak: "var(--accent-weak)",
          ink: "var(--accent-ink)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: {
        md: "var(--radius-control)",
        lg: "var(--radius-card)",
      },
      boxShadow: {
        overlay: "var(--shadow-overlay)",
      },
      transitionTimingFunction: {
        out: "var(--ease-out)",
      },
      transitionDelay: {
        stagger: "var(--stagger)",
      },
      transitionDuration: {
        fast: "var(--dur-fast)",
        DEFAULT: "var(--dur)",
        slow: "var(--dur-slow)",
      },
      zIndex: {
        sticky: "var(--z-sticky)",
        dropdown: "var(--z-dropdown)",
        overlay: "var(--z-overlay)",
        toast: "var(--z-toast)",
      },
    },
  },
  plugins: [],
};

export default config;
