import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./app/**/*.tsx", "./lib/**/*.tsx"],
  plugins: [tailwindcssAnimate],
} satisfies Config;
