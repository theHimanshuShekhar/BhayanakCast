/**
 * ThemeContext + ThemeSwitcher Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { ThemeProvider, useTheme, themes } from "../../../src/lib/theme-context";
import { ThemeSwitcher } from "../../../src/components/ThemeSwitcher";
import { render } from "../../utils/render";

// ─── ThemeProvider / useTheme ─────────────────────────────────────────────────

function wrapper({ children }: { children: React.ReactNode }) {
	return <ThemeProvider>{children}</ThemeProvider>;
}

describe("ThemeProvider / useTheme", () => {
	beforeEach(() => {
		// Reset data-theme attribute
		document.documentElement.removeAttribute("data-theme");
	});

	it("throws when used outside ThemeProvider", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(() => renderHook(() => useTheme())).toThrow(
			"useTheme must be used within a ThemeProvider",
		);
		spy.mockRestore();
	});

	it("provides default theme on mount", () => {
		const { result } = renderHook(() => useTheme(), { wrapper });
		expect(result.current.theme).toBe("purple-blue");
	});

	it("setTheme changes the active theme", () => {
		const { result } = renderHook(() => useTheme(), { wrapper });

		act(() => { result.current.setTheme("onyx-black"); });

		expect(result.current.theme).toBe("onyx-black");
	});

	it("setTheme updates data-theme attribute on documentElement", () => {
		const { result } = renderHook(() => useTheme(), { wrapper });

		act(() => { result.current.setTheme("misty-blue"); });

		expect(document.documentElement.getAttribute("data-theme")).toBe("misty-blue");
	});

	it("setTheme stores theme in localStorage", () => {
		const { result } = renderHook(() => useTheme(), { wrapper });

		act(() => { result.current.setTheme("blue-gray"); });

		expect(window.localStorage.setItem).toHaveBeenCalledWith(
			"bhayanakcast-theme",
			"blue-gray",
		);
	});

	it("cycleTheme advances to the next theme in the list", () => {
		const { result } = renderHook(() => useTheme(), { wrapper });

		// Default theme is "purple-blue" (index 0)
		act(() => { result.current.cycleTheme(); });

		// Should advance to index 1
		expect(result.current.theme).toBe(themes[1]);
	});

	it("cycleTheme wraps around from last theme to first", () => {
		const { result } = renderHook(() => useTheme(), { wrapper });

		// Set to last theme
		act(() => { result.current.setTheme(themes[themes.length - 1]); });

		act(() => { result.current.cycleTheme(); });

		expect(result.current.theme).toBe(themes[0]);
	});

	it("loads saved theme from localStorage on mount", () => {
		vi.mocked(window.localStorage.getItem).mockReturnValueOnce("onyx-black");

		const { result } = renderHook(() => useTheme(), { wrapper });

		// Wait for useEffect to run
		expect(result.current.theme).toBe("onyx-black");
	});

	it("ignores invalid saved theme from localStorage", () => {
		vi.mocked(window.localStorage.getItem).mockReturnValueOnce("invalid-theme");

		const { result } = renderHook(() => useTheme(), { wrapper });

		expect(result.current.theme).toBe("purple-blue");
	});
});

// ─── ThemeSwitcher ────────────────────────────────────────────────────────────

describe("ThemeSwitcher", () => {
	it("renders a button with title 'Cycle theme'", () => {
		render(
			<ThemeProvider>
				<ThemeSwitcher isExpanded={false} />
			</ThemeProvider>,
		);
		expect(screen.getByTitle("Cycle theme")).toBeInTheDocument();
	});

	it("renders compact size button when compact prop is true", () => {
		render(
			<ThemeProvider>
				<ThemeSwitcher isExpanded={false} compact={true} />
			</ThemeProvider>,
		);
		expect(screen.getByTitle("Cycle theme")).toBeInTheDocument();
	});

	it("shows Theme Switcher label text when expanded", () => {
		render(
			<ThemeProvider>
				<ThemeSwitcher isExpanded={true} />
			</ThemeProvider>,
		);
		expect(screen.getByText("Theme Switcher")).toBeInTheDocument();
	});

	it("calls cycleTheme when clicked", async () => {
		const user = userEvent.setup();
		render(
			<ThemeProvider>
				<ThemeSwitcher isExpanded={false} />
			</ThemeProvider>,
		);
		const button = screen.getByTitle("Cycle theme");
		await user.click(button);
		// After click, data-theme should change from purple-blue to next
		expect(document.documentElement.getAttribute("data-theme")).toBe(themes[1]);
	});
});
