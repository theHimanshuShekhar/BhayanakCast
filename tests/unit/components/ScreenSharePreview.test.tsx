/**
 * ScreenSharePreview Component Tests
 */

if (typeof MediaStream === "undefined") {
	(globalThis as Record<string, unknown>).MediaStream = class {
		id = "mock-stream";
		getTracks() {
			return [];
		}
	};
}

// jsdom does not implement HTMLMediaElement.play — stub it
Object.defineProperty(HTMLMediaElement.prototype, "play", {
	configurable: true,
	value: () => Promise.resolve(),
});

import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { render } from "../../utils/render";
import { ScreenSharePreview } from "../../../src/components/ScreenSharePreview";

describe("ScreenSharePreview", () => {
	it("shows ready-to-stream placeholder when no stream is provided", () => {
		render(<ScreenSharePreview stream={null} />);
		expect(screen.getByText("Ready to Stream")).toBeInTheDocument();
		expect(screen.getByText(/Click "Start Streaming"/)).toBeInTheDocument();
	});

	it("does not render a video element when no stream", () => {
		const { container } = render(<ScreenSharePreview stream={null} />);
		expect(container.querySelector("video")).not.toBeInTheDocument();
	});

	it("renders a video element and LIVE badge when stream is active", () => {
		const mockStream = new MediaStream();
		const { container } = render(<ScreenSharePreview stream={mockStream} />);
		expect(container.querySelector("video")).toBeInTheDocument();
		expect(screen.getByText(/LIVE/)).toBeInTheDocument();
	});

	it("does not show placeholder when stream is provided", () => {
		const mockStream = new MediaStream();
		render(<ScreenSharePreview stream={mockStream} />);
		expect(screen.queryByText("Ready to Stream")).not.toBeInTheDocument();
	});
});
