import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b0f14",
        card: "#121826",
        accent: "#4d7dff",
        accent2: "#8b5cf6",
        muted: "#8ea0bd"
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"]
      },
      boxShadow: {
        panel: "0 10px 28px rgba(0,0,0,0.35)"
      }
    }
  },
  plugins: []
};

export default config;
