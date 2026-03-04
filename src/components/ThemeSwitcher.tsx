import { Palette } from "lucide-react";
import { useTheme } from "#/lib/theme-context";

interface ThemeSwitcherProps {
	isExpanded: boolean;
}

export function ThemeSwitcher({ isExpanded }: ThemeSwitcherProps) {
	const { cycleTheme } = useTheme();

	return (
		<button
			type="button"
			onClick={cycleTheme}
			className={`flex items-center justify-center rounded-xl transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] bg-depth-2 hover:bg-depth-3 text-accent ${
				isExpanded ? "w-full px-3 py-2.5 gap-3" : "w-12 h-12"
			}`}
			title="Cycle theme"
		>
			<Palette className="h-5 w-5 shrink-0" />
			<span
				className={`text-sm font-medium whitespace-nowrap overflow-hidden transition-all duration-300 ${
					isExpanded
						? "opacity-100 max-w-[140px] ml-1"
						: "opacity-0 max-w-0 w-0 ml-0"
				}`}
			>
				Theme Switcher
			</span>
		</button>
	);
}
