import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: { colors: { ink: "#0b1118", panel: "#111b26", line: "#243444", mint: "#6ee7b7", amber: "#fbbf24", coral: "#fb7185" }, fontFamily: { sans: ["var(--font-geist)", "sans-serif"] } } },
  plugins: []
} satisfies Config;
