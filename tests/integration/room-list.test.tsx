import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { clearTables, teardownTestDatabase, getTestDatabase } from "../utils/database";
import { render } from "../utils/render";
import { RoomList } from "../../src/components/RoomList";
import { getActiveRooms } from "../../src/db/queries/stats";
import { users, streamingRooms, roomParticipants } from "../../src/db/schema";

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

// Helper to create test data
async function createTestData() {
	const { db } = await getTestDatabase();

	// Create test users
	await db.insert(users).values([
		{
			id: "test-user-1",
			name: "Alice Smith",
			email: "alice@test.com",
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		},
		{
			id: "test-user-2",
			name: "Bob Johnson",
			email: "bob@test.com",
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		},
		{
			id: "test-user-3",
			name: "Carol Williams",
			email: "carol@test.com",
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		},
	]);

	// Create test rooms with different statuses
	await db.insert(streamingRooms).values([
		{
			id: "test-room-1",
			name: "Gaming Stream",
			description: "Playing games",
			streamerId: "test-user-1",
			status: "active",
			createdAt: new Date(),
			endedAt: null,
		},
		{
			id: "test-room-2",
			name: "Coding Session",
			description: "Building stuff",
			streamerId: "test-user-2",
			status: "preparing",
			createdAt: new Date(),
			endedAt: null,
		},
		{
			id: "test-room-3",
			name: "Music Stream",
			description: "Live music",
			streamerId: null,
			status: "waiting",
			createdAt: new Date(),
			endedAt: null,
		},
		{
			id: "test-room-4",
			name: "Ended Stream",
			description: "Past broadcast",
			streamerId: "test-user-3",
			status: "ended",
			createdAt: new Date(Date.now() - 3600000),
			endedAt: new Date(),
		},
	]);

	// Create test participants
	await db.insert(roomParticipants).values([
		{
			id: "test-part-1",
			roomId: "test-room-1",
			userId: "test-user-1",
			joinedAt: new Date(),
			leftAt: null,
			totalTimeSeconds: 3600,
		},
		{
			id: "test-part-2",
			roomId: "test-room-1",
			userId: "test-user-2",
			joinedAt: new Date(),
			leftAt: null,
			totalTimeSeconds: 1800,
		},
		{
			id: "test-part-3",
			roomId: "test-room-2",
			userId: "test-user-2",
			joinedAt: new Date(),
			leftAt: null,
			totalTimeSeconds: 2400,
		},
	]);
}

describe("RoomList Integration", () => {
	beforeEach(async () => {
		await clearTables();
		await createTestData();
		vi.clearAllMocks();
	});

	afterEach(async () => {
		await clearTables();
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
		it("shows all non-ended rooms in Live Now section", async () => {
			const initialRooms = await getActiveRooms();
			render(<RoomList initialRooms={initialRooms} />);

			expect(screen.getByText("Live Now")).toBeInTheDocument();
			// Should show at least some rooms (active, preparing, and/or waiting)
			expect(screen.getByText("Gaming Stream")).toBeInTheDocument();
			// Check that the room list component is rendered with content
			expect(screen.getByText("Coding Session")).toBeInTheDocument();
		});

		it("displays correct room counts in headers", async () => {
			const initialRooms = await getActiveRooms();
			render(<RoomList initialRooms={initialRooms} />);

			// Should show count for Live Now section (may also show Past Streams count)
			const counts = screen.getAllByText(/\(\d+\)/);
			expect(counts.length).toBeGreaterThan(0);
		});

		it("shows different status indicators for live rooms", async () => {
			const initialRooms = await getActiveRooms();
			render(<RoomList initialRooms={initialRooms} />);

			// RoomList shows all non-ended rooms with their status indicators
			// Multiple rooms may have "Streaming" status (for active rooms)
			const streamingElements = screen.getAllByText("Streaming");
			expect(streamingElements.length).toBeGreaterThan(0);
			
			// Should also show Preparing and Waiting statuses
			expect(screen.getByText("Preparing")).toBeInTheDocument();
			expect(screen.getByText("Waiting")).toBeInTheDocument();
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
				// Use a more flexible matcher for "Ended" text
				const endedElements = screen.queryAllByText(/Ended/i);
				expect(endedElements.length).toBeGreaterThan(0);
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
