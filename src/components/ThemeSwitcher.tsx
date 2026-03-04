import { Palette } from "lucide-react";
import { useTheme } from "#/lib/theme-context";

interface ThemeSwitcherProps {
	isExpanded: boolean;
}

export function ThemeSwitcher({ isExpanded }: ThemeSwitcherProps) {
	const { cycleTheme } = useTheme();

	const buttonClass =
		"flex items-center justify-center rounded-xl transition-all duration-200 hover:scale-[1.05] active:scale-[0.95]";

	if (isExpanded) {
		return (
			<button
				type="button"
				onClick={cycleTheme}
				className={`${buttonClass} w-full px-4 py-3 gap-2 bg-depth-2 hover:bg-depth-3 text-accent`}
				title="Cycle theme"
			>
				<Palette className="h-5 w-5" />
			</button>
		);
	}

	return (
		<button
			type="button"
			onClick={cycleTheme}
			className={`${buttonClass} w-12 h-12 bg-depth-2 hover:bg-depth-3 text-accent`}
			title="Cycle theme"
		>
			<Palette className="h-5 w-5" />
		</button>
	);
}
