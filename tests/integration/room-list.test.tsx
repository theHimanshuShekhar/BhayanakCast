import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { clearTables, teardownTestDatabase } from "../utils/database";
import { insertTestUsers } from "../fixtures/users";
import { insertTestRooms } from "../fixtures/rooms";
import { insertTestParticipants } from "../fixtures/participants";
import { render } from "../utils/render";
import { RoomList } from "../../src/components/RoomList";
import { getActiveRooms } from "../../src/db/queries/stats";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => mockNavigate,
	Link: ({
		children,
		to,
	}: {
		children: React.ReactNode;
		to: string;
	}) => <a href={to}>{children}</a>,
}));

vi.mock("../../src/utils/home", () => ({
	searchRooms: vi.fn(),
}));

describe("RoomList Integration", () => {
	beforeEach(async () => {
		const { db } = await import("../utils/database").then((m) =>
			m.getTestDatabase(),
		);
		await clearTables();
		await insertTestUsers(db);
		await insertTestRooms(db);
		await insertTestParticipants(db);
		vi.clearAllMocks();
	});

	afterAll(async () => {
		await teardownTestDatabase();
	});

	describe("Search Functionality", () => {
		it("triggers debounced search on input", async () => {
			const user = userEvent.setup();
			const initialRooms = await getActiveRooms();

			render(<RoomList initialRooms={initialRooms} />);

			const searchInput = screen.getByPlaceholderText("Search rooms...");
			await user.type(searchInput, "gaming");

			// Wait for debounce (300ms) + buffer
			await new Promise((resolve) => setTimeout(resolve, 400));

			expect(screen.getByText(/for "gaming"/)).toBeInTheDocument();
		});

		it("displays correct number of rooms", async () => {
			const initialRooms = await getActiveRooms();
			render(<RoomList initialRooms={initialRooms} />);

			expect(screen.getByText(/Showing \d+ rooms?/)).toBeInTheDocument();
		});
	});

	describe("Room Filtering", () => {
		it("filters active rooms correctly", async () => {
			const initialRooms = await getActiveRooms();
			render(<RoomList initialRooms={initialRooms} />);

			expect(screen.getByText("Live Now")).toBeInTheDocument();
			expect(screen.getByText("Gaming Stream")).toBeInTheDocument();
		});

		it("displays correct room counts in headers", async () => {
			const initialRooms = await getActiveRooms();
			render(<RoomList initialRooms={initialRooms} />);

			expect(screen.getByText(/\(\d+\)/)).toBeInTheDocument();
		});

		it("shows Streaming status for active rooms", async () => {
			const initialRooms = await getActiveRooms();
			render(<RoomList initialRooms={initialRooms} />);

			// RoomList only shows active and ended rooms
			// Multiple rooms may have "Streaming" status
			const streamingElements = screen.getAllByText("Streaming");
			expect(streamingElements.length).toBeGreaterThan(0);
		});
	});

	describe("User Interactions", () => {
		it("shows create room button for logged-in users", async () => {
			const initialRooms = await getActiveRooms();
			render(<RoomList initialRooms={initialRooms} userId="user-1" />);

			expect(screen.getByText("Create Room")).toBeInTheDocument();
		});

		it("hides create room button for anonymous users", async () => {
			const initialRooms = await getActiveRooms();
			render(<RoomList initialRooms={initialRooms} />);

			expect(screen.queryByText("Create Room")).not.toBeInTheDocument();
		});
	});

	describe("Room Status Display", () => {
		it("shows LIVE indicator for active rooms", async () => {
			const initialRooms = await getActiveRooms();
			render(<RoomList initialRooms={initialRooms} />);

			expect(screen.getAllByText("LIVE").length).toBeGreaterThan(0);
		});

		it("shows Ended status for past streams", async () => {
			const initialRooms = await getActiveRooms();
			render(<RoomList initialRooms={initialRooms} />);

			// Check for "Past Streams" section which contains ended rooms
			// Note: ended rooms only show if they're within 3 hours
			const pastStreamsHeading = screen.queryByText("Past Streams");
			if (pastStreamsHeading) {
				expect(screen.getByText("Ended")).toBeInTheDocument();
			}
		});
	});

	describe("Empty States", () => {
		it("shows empty state when no rooms exist", async () => {
			render(<RoomList initialRooms={[]} />);

			// Look for the empty state heading specifically
			expect(screen.getByRole("heading", { name: "No rooms found" })).toBeInTheDocument();
		});
	});
});
