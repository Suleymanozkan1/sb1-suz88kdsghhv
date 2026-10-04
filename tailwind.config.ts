import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 50: "#f6f7f9", 100: "#eceef2", 200: "#d5d9e2", 300: "#b0b8c9", 400: "#8592ab", 500: "#667391", 600: "#515c78", 700: "#434b62", 800: "#3a4053", 900: "#1e2230", 950: "#13151d" },
        brand: { 50: "#eefbf4", 100: "#d6f5e3", 200: "#b0eacb", 300: "#7cd8ad", 400: "#46bf89", 500: "#23a46f", 600: "#158459", 700: "#126a4a", 800: "#11543c", 900: "#0f4533" },
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
