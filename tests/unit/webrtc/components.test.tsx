/**
 * WebRTC Components Unit Tests
 *
 * Tests for StreamerControls, AudioConfigModal, and video components
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { StreamerControls } from "#/components/StreamerControls";
import { AudioConfigModal } from "#/components/AudioConfigModal";
import { useStreaming } from "#/lib/streaming-context";
import { detectDevice } from "#/lib/device-detection";

// Mock dependencies
vi.mock("#/lib/streaming-context");
vi.mock("#/lib/device-detection");

describe("StreamerControls", () => {
	const mockStartScreenShare = vi.fn();
	const mockStopScreenShare = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();

		// Default: Desktop user, not streaming
		(vi.mocked(detectDevice) as ReturnType<typeof vi.fn>).mockReturnValue({
			isMobile: false,
			canStream: true,
			canView: true,
			deviceType: "desktop",
			userAgent: "Desktop",
		});

		(vi.mocked(useStreaming) as ReturnType<typeof vi.fn>).mockReturnValue({
			isScreenSharing: false,
			isStreamer: false,
			deviceCapabilities: { isMobile: false, canStream: true },
			startScreenShare: mockStartScreenShare,
			stopScreenShare: mockStopScreenShare,
			audioConfig: "system-and-mic",
			isAudioEnabled: true,
			toggleAudio: vi.fn(),
		});
	});

	describe("Desktop User - Not Streaming", () => {
		it("renders start streaming button for desktop", () => {
			render(<StreamerControls />);

			expect(screen.getByText("Start Streaming")).toBeInTheDocument();
			expect(screen.getByRole("button")).not.toBeDisabled();
		});

		it("opens audio config modal when clicking start", () => {
			render(<StreamerControls />);

			fireEvent.click(screen.getByText("Start Streaming"));

			expect(screen.getByText("Start Screen Sharing")).toBeInTheDocument();
			expect(screen.getByText("Audio")).toBeInTheDocument();
		});
	});

	describe("Desktop User - Streaming", () => {
		const mockToggleAudio = vi.fn();

		beforeEach(() => {
			(vi.mocked(useStreaming) as ReturnType<typeof vi.fn>).mockReturnValue({
				isScreenSharing: true,
				isStreamer: true,
				deviceCapabilities: { isMobile: false, canStream: true },
				startScreenShare: mockStartScreenShare,
				stopScreenShare: mockStopScreenShare,
				audioConfig: "system-and-mic",
				isAudioEnabled: true,
				toggleAudio: mockToggleAudio,
			});
		});

		it("shows streaming controls when active", () => {
			render(<StreamerControls />);

			expect(screen.getByText("Stop Sharing")).toBeInTheDocument();
			expect(screen.getByText("LIVE")).toBeInTheDocument();
			expect(screen.getByText("System + Mic")).toBeInTheDocument();
		});

		it("calls stopScreenShare when clicking stop", () => {
			render(<StreamerControls />);

			fireEvent.click(screen.getByText("Stop Sharing"));

			expect(mockStopScreenShare).toHaveBeenCalled();
		});

		it("toggles audio mute button", () => {
			render(<StreamerControls />);

			const muteButton = screen.getByTitle("Mute audio");
			expect(muteButton).toBeInTheDocument();

			fireEvent.click(muteButton);
		});
	});

	describe("Mobile User", () => {
		beforeEach(() => {
			(vi.mocked(detectDevice) as ReturnType<typeof vi.fn>).mockReturnValue({
				isMobile: true,
				canStream: false,
				canView: true,
				deviceType: "mobile",
				userAgent: "Mobile",
			});

			(vi.mocked(useStreaming) as ReturnType<typeof vi.fn>).mockReturnValue({
				isScreenSharing: false,
				deviceCapabilities: { isMobile: true, canStream: false },
				startScreenShare: mockStartScreenShare,
				stopScreenShare: mockStopScreenShare,
			});
		});

		it("shows disabled button for mobile users", () => {
			render(<StreamerControls />);

			const button = screen.getByText("Start Streaming");
			expect(button).toBeDisabled();
		});

		it("shows mobile restriction message", () => {
			render(<StreamerControls />);

			expect(screen.getByText("Mobile devices cannot stream")).toBeInTheDocument();
		});
	});

	describe("Audio Configuration Display", () => {
		it.each([
			["system-and-mic", "System + Mic"],
			["system-only", "System only"],
			["no-audio", ""],
		])("displays correct audio config: %s", (audioConfig, expectedText) => {
			(vi.mocked(useStreaming) as ReturnType<typeof vi.fn>).mockReturnValue({
				isScreenSharing: true,
				deviceCapabilities: { isMobile: false },
				startScreenShare: mockStartScreenShare,
				stopScreenShare: mockStopScreenShare,
				audioConfig,
			});

			render(<StreamerControls />);

			if (expectedText) {
				expect(screen.getByText(expectedText)).toBeInTheDocument();
			}
		});
	});
});

describe("AudioConfigModal", () => {
	const mockOnClose = vi.fn();
	const mockOnStart = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders when open", () => {
		render(
			<AudioConfigModal
				isOpen={true}
				onClose={mockOnClose}
				onStart={mockOnStart}
			/>,
		);

		expect(screen.getByText("Start Screen Sharing")).toBeInTheDocument();
		expect(screen.getByText("Audio")).toBeInTheDocument();
		expect(screen.getByText("Show Cursor")).toBeInTheDocument();
	});

	it("does not render when closed", () => {
		render(
			<AudioConfigModal
				isOpen={false}
				onClose={mockOnClose}
				onStart={mockOnStart}
			/>,
		);

		expect(screen.queryByText("Start Screen Sharing")).not.toBeInTheDocument();
	});

	describe("Audio Options", () => {
		it("renders all audio options", () => {
			render(
				<AudioConfigModal
					isOpen={true}
					onClose={mockOnClose}
					onStart={mockOnStart}
				/>,
			);

			expect(screen.getByText("System audio + Microphone")).toBeInTheDocument();
			expect(screen.getByText("Share your computer audio and voice")).toBeInTheDocument();
			expect(screen.getByText("System audio only")).toBeInTheDocument();
			expect(screen.getByText("Share your computer audio without microphone")).toBeInTheDocument();
			expect(screen.getByText("No audio")).toBeInTheDocument();
			expect(screen.getByText("Silent stream")).toBeInTheDocument();
		});

		it("selects different audio options", () => {
			render(
				<AudioConfigModal
					isOpen={true}
					onClose={mockOnClose}
					onStart={mockOnStart}
				/>,
			);

			fireEvent.click(screen.getByText("System audio only"));
			fireEvent.click(screen.getByText("Share Screen"));

			expect(mockOnStart).toHaveBeenCalledWith(
				expect.objectContaining({
					audioConfig: "system-only",
				}),
			);
		});
	});

	describe("Cursor Options", () => {
		it("renders all cursor options", () => {
			render(
				<AudioConfigModal
					isOpen={true}
					onClose={mockOnClose}
					onStart={mockOnStart}
				/>,
			);

			expect(screen.getByText("Always")).toBeInTheDocument();
			expect(screen.getByText("Motion")).toBeInTheDocument();
			expect(screen.getByText("Never")).toBeInTheDocument();
		});

		it("selects different cursor options", () => {
			render(
				<AudioConfigModal
					isOpen={true}
					onClose={mockOnClose}
					onStart={mockOnStart}
				/>,
			);

			fireEvent.click(screen.getByText("Never"));
			fireEvent.click(screen.getByText("Share Screen"));

			expect(mockOnStart).toHaveBeenCalledWith(
				expect.objectContaining({
					cursor: "never",
				}),
			);
		});
	});

	describe("Button Actions", () => {
		it("calls onStart with correct options when clicking share", () => {
			render(
				<AudioConfigModal
					isOpen={true}
					onClose={mockOnClose}
					onStart={mockOnStart}
				/>,
			);

			fireEvent.click(screen.getByText("System audio only"));
			fireEvent.click(screen.getByText("Never"));
			fireEvent.click(screen.getByText("Share Screen"));

			expect(mockOnStart).toHaveBeenCalledWith({
				audioConfig: "system-only",
				cursor: "never",
				displaySurface: "default",
			});
		});

		it("calls onClose when clicking cancel", () => {
			render(
				<AudioConfigModal
					isOpen={true}
					onClose={mockOnClose}
					onStart={mockOnStart}
				/>,
			);

			fireEvent.click(screen.getByText("Cancel"));

			expect(mockOnClose).toHaveBeenCalled();
			expect(mockOnStart).not.toHaveBeenCalled();
		});
	});
});
