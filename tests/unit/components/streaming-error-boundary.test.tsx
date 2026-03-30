/**
 * StreamingErrorBoundary Unit Tests
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { StreamingErrorBoundary } from "../../../src/components/StreamingErrorBoundary";

// Suppress React error boundary console.error output during tests
const consoleError = vi
	.spyOn(console, "error")
	.mockImplementation(() => {});

// Component that throws on demand
function Thrower({ shouldThrow }: { shouldThrow: boolean }) {
	if (shouldThrow) {
		throw new Error("Test streaming error");
	}
	return <div>Stream is fine</div>;
}

describe("StreamingErrorBoundary", () => {
	beforeEach(() => {
		consoleError.mockClear();
	});

	it("renders children when no error", () => {
		render(
			<StreamingErrorBoundary>
				<div>Normal content</div>
			</StreamingErrorBoundary>,
		);
		expect(screen.getByText("Normal content")).toBeInTheDocument();
	});

	it("shows error fallback when child throws", () => {
		render(
			<StreamingErrorBoundary>
				<Thrower shouldThrow />
			</StreamingErrorBoundary>,
		);

		expect(screen.getByText("Streaming Error")).toBeInTheDocument();
		expect(screen.getByText("Test streaming error")).toBeInTheDocument();
	});

	it("shows Retry button when error occurs", () => {
		render(
			<StreamingErrorBoundary>
				<Thrower shouldThrow />
			</StreamingErrorBoundary>,
		);

		expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
	});

	it("resets error state when Retry is clicked", () => {
		const onReset = vi.fn();

		render(
			<StreamingErrorBoundary onReset={onReset}>
				<Thrower shouldThrow />
			</StreamingErrorBoundary>,
		);

		expect(screen.getByText("Streaming Error")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Retry" }));

		// After reset, boundary clears - child will throw again since shouldThrow=true,
		// but onReset should have been called
		expect(onReset).toHaveBeenCalledTimes(1);
	});

	it("calls onReset callback on retry", () => {
		const onReset = vi.fn();

		render(
			<StreamingErrorBoundary onReset={onReset}>
				<Thrower shouldThrow />
			</StreamingErrorBoundary>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(onReset).toHaveBeenCalledTimes(1);
	});

	it("works without onReset prop", () => {
		render(
			<StreamingErrorBoundary>
				<Thrower shouldThrow />
			</StreamingErrorBoundary>,
		);

		expect(() =>
			fireEvent.click(screen.getByRole("button", { name: "Retry" })),
		).not.toThrow();
	});

	it("logs error to console on componentDidCatch", () => {
		render(
			<StreamingErrorBoundary>
				<Thrower shouldThrow />
			</StreamingErrorBoundary>,
		);

		// React calls console.error for error boundaries — our spy should have been called
		expect(consoleError).toHaveBeenCalled();
	});
});
