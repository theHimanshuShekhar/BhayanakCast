/**
 * VideoDisplay Unit Tests
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { VideoDisplay } from "../../../src/components/VideoDisplay";

// Mock lucide-react icons to avoid SVG issues in jsdom
vi.mock("lucide-react", () => ({
	Video: () => <svg data-testid="icon-video" />,
	Monitor: () => <svg data-testid="icon-monitor" />,
	WifiOff: () => <svg data-testid="icon-wifi-off" />,
	RefreshCw: () => <svg data-testid="icon-refresh" />,
}));

// jsdom doesn't implement MediaStream — provide a minimal stub
if (typeof MediaStream === "undefined") {
	(globalThis as Record<string, unknown>).MediaStream = class MediaStream {
		getTracks() { return []; }
	};
}

describe("VideoDisplay", () => {
	describe("idle state (no stream)", () => {
		it("shows waiting message when idle", () => {
			render(<VideoDisplay stream={null} />);
			expect(screen.getByText("Waiting for Stream")).toBeInTheDocument();
		});

		it("shows streamer name hint when provided", () => {
			render(<VideoDisplay stream={null} streamerName="Alice" />);
			expect(
				screen.getByText("Alice will start streaming soon"),
			).toBeInTheDocument();
		});

		it("shows generic message when no streamer name", () => {
			render(<VideoDisplay stream={null} />);
			expect(screen.getByText("No streamer yet")).toBeInTheDocument();
		});
	});

	describe("connecting state", () => {
		it("shows connecting message", () => {
			render(
				<VideoDisplay
					stream={null}
					connectionStatus="connecting"
				/>,
			);
			expect(screen.getByText("Connecting to stream...")).toBeInTheDocument();
		});

		it("shows refresh icon while connecting", () => {
			render(
				<VideoDisplay
					stream={null}
					connectionStatus="connecting"
				/>,
			);
			expect(screen.getByTestId("icon-refresh")).toBeInTheDocument();
		});

		it("shows retry attempt number when retrying", () => {
			render(
				<VideoDisplay
					stream={null}
					connectionStatus="connecting"
					retryAttempt={3}
				/>,
			);
			expect(screen.getByText("Retry attempt 3")).toBeInTheDocument();
		});

		it("hides retry text when attempt is 0", () => {
			render(
				<VideoDisplay
					stream={null}
					connectionStatus="connecting"
					retryAttempt={0}
				/>,
			);
			expect(screen.queryByText(/Retry attempt/)).not.toBeInTheDocument();
		});
	});

	describe("reconnecting state", () => {
		it("shows connecting message when reconnecting", () => {
			render(
				<VideoDisplay
					stream={null}
					connectionStatus="reconnecting"
				/>,
			);
			expect(screen.getByText("Connecting to stream...")).toBeInTheDocument();
		});
	});

	describe("failed state", () => {
		it("shows failed message", () => {
			render(
				<VideoDisplay
					stream={null}
					connectionStatus="failed"
				/>,
			);
			expect(screen.getByText("Connection failed")).toBeInTheDocument();
		});

		it("shows reconnecting hint", () => {
			render(
				<VideoDisplay
					stream={null}
					connectionStatus="failed"
				/>,
			);
			expect(
				screen.getByText("Attempting to reconnect..."),
			).toBeInTheDocument();
		});

		it("shows wifi-off icon", () => {
			render(
				<VideoDisplay
					stream={null}
					connectionStatus="failed"
				/>,
			);
			expect(screen.getByTestId("icon-wifi-off")).toBeInTheDocument();
		});
	});

	describe("connected state (with stream)", () => {
		it("renders video element when stream is provided", () => {
			const mockStream = new MediaStream();
			const { container } = render(
				<VideoDisplay
					stream={mockStream}
					streamerName="Bob"
					connectionStatus="connected"
				/>,
			);
			expect(container.querySelector("video")).toBeInTheDocument();
		});

		it("shows streamer name label on video", () => {
			const mockStream = new MediaStream();
			render(
				<VideoDisplay
					stream={mockStream}
					streamerName="Bob"
					connectionStatus="connected"
				/>,
			);
			expect(screen.getByText("Bob's Screen")).toBeInTheDocument();
		});

		it("shows generic label when no streamer name", () => {
			const mockStream = new MediaStream();
			render(
				<VideoDisplay stream={mockStream} connectionStatus="connected" />,
			);
			expect(screen.getByText("Screen Share")).toBeInTheDocument();
		});
	});
});
