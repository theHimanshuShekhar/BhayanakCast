import { MoonIcon, SunIcon } from "lucide-react";
import { useEffect } from "react";
import { Button } from "./ui/button";

export default function ThemeToggle() {
  // Sync theme on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const theme = localStorage.getItem("theme");
    if (
      theme === "dark" ||
      (!theme && window.matchMedia("(prefers-color-scheme: dark)").matches)
    ) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  function toggleTheme() {
    if (typeof window === "undefined") return;
    if (
      document.documentElement.classList.contains("dark") ||
      (!localStorage.getItem("theme") &&
        window.matchMedia("(prefers-color-scheme: dark)").matches)
    ) {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    } else {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    }
  }

  return (
    <Button variant="outline" size="icon" type="button" onClick={toggleTheme}>
      <SunIcon className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <MoonIcon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
