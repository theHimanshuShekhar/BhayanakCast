/**
 * TransferOverlay Unit Tests
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { TransferOverlay } from "../../../src/components/TransferOverlay";

vi.mock("lucide-react", () => ({
	ArrowLeftRight: () => <svg data-testid="icon-transfer" />,
	RefreshCw: () => <svg data-testid="icon-refresh" />,
}));

describe("TransferOverlay", () => {
	describe("visibility", () => {
		it("renders nothing when isTransferring is false", () => {
			const { container } = render(
				<TransferOverlay isTransferring={false} />,
			);
			expect(container.firstChild).toBeNull();
		});

		it("renders overlay when isTransferring is true", () => {
			render(<TransferOverlay isTransferring />);
			expect(screen.getByTestId("transfer-overlay")).toBeInTheDocument();
		});
	});

	describe("content", () => {
		it("shows Streamer Changed heading", () => {
			render(<TransferOverlay isTransferring />);
			expect(screen.getByText("Streamer Changed")).toBeInTheDocument();
		});

		it("shows old streamer name when provided", () => {
			render(
				<TransferOverlay isTransferring oldStreamerName="Alice" />,
			);
			expect(screen.getByText("Alice has left")).toBeInTheDocument();
		});

		it("shows new streamer name when provided", () => {
			render(
				<TransferOverlay isTransferring newStreamerName="Bob" />,
			);
			expect(screen.getByText("Bob is now streaming")).toBeInTheDocument();
		});

		it("shows both names when both provided", () => {
			render(
				<TransferOverlay
					isTransferring
					oldStreamerName="Alice"
					newStreamerName="Bob"
				/>,
			);
			expect(screen.getByText("Alice has left")).toBeInTheDocument();
			expect(screen.getByText("Bob is now streaming")).toBeInTheDocument();
		});

		it("shows waiting message when no new streamer name", () => {
			render(<TransferOverlay isTransferring />);
			expect(
				screen.getByText("Waiting for new streamer..."),
			).toBeInTheDocument();
		});

		it("hides old streamer name when not provided", () => {
			render(<TransferOverlay isTransferring newStreamerName="Bob" />);
			expect(screen.queryByText(/has left/)).not.toBeInTheDocument();
		});

		it("shows connecting indicator", () => {
			render(<TransferOverlay isTransferring />);
			expect(
				screen.getByText("Connecting to new stream..."),
			).toBeInTheDocument();
		});

		it("shows transfer icon", () => {
			render(<TransferOverlay isTransferring />);
			expect(screen.getByTestId("icon-transfer")).toBeInTheDocument();
		});
	});
});
