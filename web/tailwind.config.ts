import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        panel: "var(--panel)",
        hover: "var(--hover)",
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
        },
        success: "var(--success)",
        danger: "var(--danger)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: {
        md: "6px",
        lg: "8px",
      },
    },
  },
  plugins: [],
};

export default config;
