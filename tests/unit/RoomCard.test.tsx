import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { render } from "../utils/render";
import { RoomCard, RoomCardSkeleton } from "../../src/components/RoomCard";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		params,
	}: {
		children: React.ReactNode;
		to: string;
		params?: { roomId: string };
	}) => (
		<a href={to.replace("$roomId", params?.roomId || "")}>{children}</a>
	),
}));

describe("RoomCard", () => {
	const mockRoom = {
		id: "room-1",
		name: "Test Room",
		description: "Test Description",
		streamerName: "Alice",
		streamerImage: "https://example.com/alice.png",
		participantCount: 5,
		status: "active" as const,
		createdAt: new Date(),
	};

	it("renders room name and description", () => {
		render(<RoomCard room={mockRoom} />);
		expect(screen.getByText("Test Room")).toBeInTheDocument();
		expect(screen.getByText("Test Description")).toBeInTheDocument();
	});

	it("renders streamer info with image", () => {
		render(<RoomCard room={mockRoom} />);
		expect(screen.getByText("Alice")).toBeInTheDocument();
		expect(screen.getByAltText("Alice")).toHaveAttribute(
			"src",
			"https://example.com/alice.png",
		);
	});

	it("shows initial avatar when no streamer image", () => {
		const roomWithoutImage = { ...mockRoom, streamerImage: undefined };
		render(<RoomCard room={roomWithoutImage} />);
		expect(screen.getByText("A")).toBeInTheDocument();
	});

	it("displays 'No Streamer' when streamer is null", () => {
		const roomWithoutStreamer = { ...mockRoom, streamerName: undefined };
		render(<RoomCard room={roomWithoutStreamer} />);
		expect(screen.getByText("No Streamer")).toBeInTheDocument();
	});

	it("shows LIVE indicator for active rooms", () => {
		render(<RoomCard room={mockRoom} />);
		expect(screen.getByText("LIVE")).toBeInTheDocument();
	});

	it("displays participant count", () => {
		render(<RoomCard room={mockRoom} />);
		expect(screen.getByText("5")).toBeInTheDocument();
	});

	it("links to room detail page", () => {
		render(<RoomCard room={mockRoom} />);
		const link = screen.getByRole("link");
		expect(link).toHaveAttribute("href", "/room/room-1");
	});

	it("renders skeleton when loading", () => {
		render(<RoomCardSkeleton />);
		expect(document.querySelector(".animate-pulse")).toBeInTheDocument();
	});
});
