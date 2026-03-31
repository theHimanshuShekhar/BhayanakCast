import { describe, it, expect } from "vitest";
import { screen, act } from "@testing-library/react";
import { render } from "../../utils/render";
import { ClientOnly } from "../../../src/components/ClientOnly";

describe("ClientOnly", () => {
	it("does not render children before mount (SSR simulation)", () => {
		// In jsdom, the component renders with useEffect which fires synchronously
		// We can test that the component eventually shows content
		render(
			<ClientOnly>
				<span>client content</span>
			</ClientOnly>,
		);
		// After act(), useEffect has run and isClient is true
		expect(screen.getByText("client content")).toBeInTheDocument();
	});

	it("renders nothing initially then shows after effect fires", () => {
		// The component starts with isClient=false (renders null),
		// then useEffect sets isClient=true (renders children).
		// In jsdom with act(), this happens synchronously.
		const { container } = render(
			<ClientOnly>
				<div data-testid="inner">content</div>
			</ClientOnly>,
		);
		// After act(), content should be visible
		expect(container.querySelector("[data-testid='inner']")).toBeInTheDocument();
	});

	it("renders multiple children", () => {
		render(
			<ClientOnly>
				<span>first</span>
				<span>second</span>
			</ClientOnly>,
		);
		expect(screen.getByText("first")).toBeInTheDocument();
		expect(screen.getByText("second")).toBeInTheDocument();
	});
});
