import type { ReactNode } from "react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";

export type Theme = "purple-blue" | "misty-blue" | "onyx-black" | "blue-gray";

interface ThemeContextType {
	theme: Theme;
	setTheme: (theme: Theme) => void;
	cycleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = "bhayanakcast-theme";

export const themes: Theme[] = [
	"purple-blue",
	"misty-blue",
	"onyx-black",
	"blue-gray",
];

export function ThemeProvider({ children }: { children: ReactNode }) {
	const [theme, setThemeState] = useState<Theme>("purple-blue");

	useEffect(() => {
		const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
		if (saved && themes.includes(saved)) {
			setThemeState(saved);
			document.documentElement.setAttribute("data-theme", saved);
		} else {
			document.documentElement.setAttribute("data-theme", "purple-blue");
		}
	}, []);

	const setTheme = useCallback((newTheme: Theme) => {
		setThemeState(newTheme);
		localStorage.setItem(STORAGE_KEY, newTheme);
		document.documentElement.setAttribute("data-theme", newTheme);
	}, []);

	const cycleTheme = useCallback(() => {
		const currentIndex = themes.indexOf(theme);
		const nextIndex = (currentIndex + 1) % themes.length;
		const nextTheme = themes[nextIndex];
		setTheme(nextTheme);
	}, [theme, setTheme]);

	// Provide context always (even during SSR) with default/fallback values
	// This prevents "useTheme must be used within a ThemeProvider" errors during SSR
	return (
		<ThemeContext.Provider value={{ theme, setTheme, cycleTheme }}>
			{children}
		</ThemeContext.Provider>
	);
}

export function useTheme() {
	const context = useContext(ThemeContext);
	if (context === undefined) {
		throw new Error("useTheme must be used within a ThemeProvider");
	}
	return context;
}
