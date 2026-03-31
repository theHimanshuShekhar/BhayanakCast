import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { render } from "../../utils/render";
import NotFound from "../../../src/components/NotFound";

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
}));

describe("NotFound", () => {
	it("renders 404 heading", () => {
		render(<NotFound />);
		expect(screen.getByText("404")).toBeInTheDocument();
	});

	it("renders page not found message", () => {
		render(<NotFound />);
		expect(screen.getByText("Page not found")).toBeInTheDocument();
	});

	it("renders descriptive text", () => {
		render(<NotFound />);
		expect(screen.getByText(/doesn't exist/)).toBeInTheDocument();
	});

	it("renders a link to go back home", () => {
		render(<NotFound />);
		const link = screen.getByRole("link", { name: /go back home/i });
		expect(link).toBeInTheDocument();
		expect(link).toHaveAttribute("href", "/");
	});
});
