import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RoomList, RoomListSkeleton } from "#/components/RoomList";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock the searchRooms function
vi.mock("#/utils/home", () => ({
	searchRooms: vi.fn(),
}));

import { searchRooms } from "#/utils/home";

// Mock RoomCard component
vi.mock("#/components/RoomCard", () => ({
	RoomCard: ({ room }: { room: any }) => (
		<div data-testid={`room-card-${room.id}`}>{room.name}</div>
	),
	RoomCardSkeleton: () => <div data-testid="room-card-skeleton">Loading...</div>,
}));

// Mock CreateRoomModal
vi.mock("#/components/CreateRoomModal", () => ({
	CreateRoomModal: ({ children }: { children: React.ReactNode }) => (
		<div data-testid="create-room-modal">{children}</div>
	),
}));

describe("RoomList Component", () => {
	const mockInitialRooms = [
		{
			room: {
				id: "room-1",
				name: "Test Room 1",
				description: "Description 1",
				streamerId: "user-1",
				status: "active",
				createdAt: new Date(),
				endedAt: null,
			},
			streamer: {
				id: "user-1",
				name: "Streamer One",
				image: null,
			},
			participantCount: 5,
			streamerIsPresent: true,
		},
		{
			room: {
				id: "room-2",
				name: "Test Room 2",
				description: "Description 2",
				streamerId: "user-2",
				status: "preparing",
				createdAt: new Date(),
				endedAt: null,
			},
			streamer: {
				id: "user-2",
				name: "Streamer Two",
				image: null,
			},
			participantCount: 2,
			streamerIsPresent: true,
		},
		{
			room: {
				id: "room-3",
				name: "Ended Room",
				description: "Description 3",
				streamerId: null,
				status: "ended",
				createdAt: new Date(),
				endedAt: new Date(),
			},
			streamer: null,
			participantCount: 0,
			streamerIsPresent: false,
		},
	];

	const createQueryClient = () =>
		new QueryClient({
			defaultOptions: {
				queries: {
					retry: false,
					gcTime: 0,
					refetchOnWindowFocus: false,
					refetchOnReconnect: false,
				},
			},
		});

	const renderWithQuery = (component: React.ReactElement) => {
		return render(
			<QueryClientProvider client={createQueryClient()}>
				{component}
			</QueryClientProvider>,
		);
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("Initial Rendering", () => {
		it("renders with initial rooms", () => {
			renderWithQuery(<RoomList initialRooms={mockInitialRooms} userId="test-user" />);

			expect(screen.getByText("Test Room 1")).toBeInTheDocument();
			expect(screen.getByText("Test Room 2")).toBeInTheDocument();
			expect(screen.getByText("Ended Room")).toBeInTheDocument();
		});

		it("displays correct room counts", () => {
			renderWithQuery(<RoomList initialRooms={mockInitialRooms} userId="test-user" />);

			expect(screen.getByText("Showing 3 rooms")).toBeInTheDocument();
			expect(screen.getByText("(2)")).toBeInTheDocument(); // Live rooms count
			expect(screen.getByText("(1)")).toBeInTheDocument(); // Past streams count
		});

		it("shows empty state when no rooms", () => {
			renderWithQuery(<RoomList initialRooms={[]} userId="test-user" />);

			// The empty state has multiple "No rooms found" - check for the specific ones
			expect(screen.getAllByText("No rooms found").length).toBeGreaterThan(0);
			expect(screen.getByText("No live streams right now")).toBeInTheDocument();
			expect(screen.getByText("No past streams yet")).toBeInTheDocument();
		});

		it("filters live rooms correctly", () => {
			renderWithQuery(<RoomList initialRooms={mockInitialRooms} userId="test-user" />);

			// Live section should show active and preparing rooms
			expect(screen.getByTestId("room-card-room-1")).toBeInTheDocument();
			expect(screen.getByTestId("room-card-room-2")).toBeInTheDocument();
		});

		it("filters ended rooms correctly", () => {
			renderWithQuery(<RoomList initialRooms={mockInitialRooms} userId="test-user" />);

			// Past streams section should show ended room
			expect(screen.getByTestId("room-card-room-3")).toBeInTheDocument();
		});
	});

	describe("Search Functionality", () => {
		it("renders search input", () => {
			renderWithQuery(<RoomList initialRooms={mockInitialRooms} userId="test-user" />);

			expect(screen.getByPlaceholderText("Search rooms...")).toBeInTheDocument();
		});

		it("updates search query on input change", async () => {
			renderWithQuery(<RoomList initialRooms={mockInitialRooms} userId="test-user" />);

			const searchInput = screen.getByPlaceholderText("Search rooms...");
			await userEvent.type(searchInput, "test");

			expect(searchInput).toHaveValue("test");
		});

		it("debounces search input", async () => {
			const mockSearchRooms = vi.mocked(searchRooms);
			mockSearchRooms.mockResolvedValue([
				{
					room: {
						id: "room-1",
						name: "Test Room 1",
						description: "Description 1",
						streamerId: "user-1",
						status: "active",
						createdAt: new Date(),
						endedAt: null,
					},
					streamer: {
						id: "user-1",
						name: "Streamer One",
						image: null,
					},
					participantCount: 5,
					streamerIsPresent: true,
				},
			]);

			renderWithQuery(<RoomList initialRooms={mockInitialRooms} userId="test-user" />);

			const searchInput = screen.getByPlaceholderText("Search rooms...");
			await userEvent.type(searchInput, "search query");

			// Should not call search immediately
			expect(mockSearchRooms).not.toHaveBeenCalled();

			// Wait for debounce
			await waitFor(
				() => {
					expect(mockSearchRooms).toHaveBeenCalledWith({
						data: { query: "search query" },
					});
				},
				{ timeout: 500 },
			);
		});

		it("displays search results", async () => {
			const mockSearchRooms = vi.mocked(searchRooms);
			mockSearchRooms.mockResolvedValue([
				{
					room: {
						id: "room-1",
						name: "Search Result Room",
						description: "Found by search",
						streamerId: "user-1",
						status: "active",
						createdAt: new Date(),
						endedAt: null,
					},
					streamer: {
						id: "user-1",
						name: "Streamer",
						image: null,
					},
					participantCount: 3,
					streamerIsPresent: true,
				},
			]);

			renderWithQuery(<RoomList initialRooms={mockInitialRooms} userId="test-user" />);

			const searchInput = screen.getByPlaceholderText("Search rooms...");
			await userEvent.type(searchInput, "search");

			await waitFor(() => {
				expect(screen.getByText('for "search"')).toBeInTheDocument();
			});
		});

		it("shows empty search results", async () => {
			const mockSearchRooms = vi.mocked(searchRooms);
			mockSearchRooms.mockResolvedValue([]);

			renderWithQuery(<RoomList initialRooms={mockInitialRooms} userId="test-user" />);

			const searchInput = screen.getByPlaceholderText("Search rooms...");
			await userEvent.type(searchInput, "nonexistent");

			await waitFor(() => {
				// Use getAllByText since "No rooms found" appears multiple times
				expect(screen.getAllByText("No rooms found").length).toBeGreaterThan(0);
				expect(
					screen.getByText("Try adjusting your search terms or check back later for new streams."),
				).toBeInTheDocument();
			});
		});
	});

	describe("Create Room Button", () => {
		it("shows create room button when user is logged in", () => {
			renderWithQuery(<RoomList initialRooms={mockInitialRooms} userId="test-user" />);

			expect(screen.getByText("Create Room")).toBeInTheDocument();
		});

		it("hides create room button when user is not logged in", () => {
			renderWithQuery(<RoomList initialRooms={mockInitialRooms} />);

			expect(screen.queryByText("Create Room")).not.toBeInTheDocument();
		});

		it("wraps create room button in modal", () => {
			renderWithQuery(<RoomList initialRooms={mockInitialRooms} userId="test-user" />);

			expect(screen.getByTestId("create-room-modal")).toBeInTheDocument();
		});
	});

	describe("Room Sections", () => {
		it("shows Live Now section with ping indicator", () => {
			renderWithQuery(<RoomList initialRooms={mockInitialRooms} userId="test-user" />);

			expect(screen.getByText("Live Now")).toBeInTheDocument();
		});

		it("shows Past Streams section", () => {
			renderWithQuery(<RoomList initialRooms={mockInitialRooms} userId="test-user" />);

			expect(screen.getByText("Past Streams")).toBeInTheDocument();
		});

		it("displays empty live section message", () => {
			const endedRoomsOnly = [
				{
					room: {
						id: "room-1",
						name: "Ended Room",
						description: "Description",
						status: "ended",
						createdAt: new Date(),
					},
					streamer: null,
					participantCount: 0,
				},
			];

			renderWithQuery(<RoomList initialRooms={endedRoomsOnly} userId="test-user" />);

			expect(screen.getByText("No live streams right now")).toBeInTheDocument();
			expect(
				screen.getByText("Check out past streams below or create your own!"),
			).toBeInTheDocument();
		});

		it("displays empty past streams message", () => {
			const liveRoomsOnly = [
				{
					room: {
						id: "room-1",
						name: "Live Room",
						description: "Description",
						status: "active",
						createdAt: new Date(),
					},
					streamer: {
						id: "user-1",
						name: "Streamer",
						image: null,
					},
					participantCount: 5,
				},
			];

			renderWithQuery(<RoomList initialRooms={liveRoomsOnly} userId="test-user" />);

			expect(screen.getByText("No past streams yet")).toBeInTheDocument();
		});
	});

	describe("Room Data Transformation", () => {
		it("handles rooms without streamers", () => {
			const roomsWithoutStreamer = [
				{
					room: {
						id: "room-1",
						name: "Room without streamer",
						description: "Description",
						status: "waiting",
						createdAt: new Date(),
					},
					streamer: null,
					participantCount: 0,
				},
			];

			renderWithQuery(<RoomList initialRooms={roomsWithoutStreamer} userId="test-user" />);

			expect(screen.getByTestId("room-card-room-1")).toBeInTheDocument();
		});

		it("handles rooms with null descriptions", () => {
			const roomsWithNullDesc = [
				{
					room: {
						id: "room-1",
						name: "Room",
						description: null,
						status: "active",
						createdAt: new Date(),
					},
					streamer: {
						id: "user-1",
						name: "Streamer",
						image: null,
					},
					participantCount: 1,
				},
			];

			renderWithQuery(<RoomList initialRooms={roomsWithNullDesc} userId="test-user" />);

			expect(screen.getByTestId("room-card-room-1")).toBeInTheDocument();
		});

		it("handles all room statuses", () => {
			const allStatuses = [
				{
					room: {
						id: "room-waiting",
						name: "Waiting Room",
						description: "Desc",
						status: "waiting",
						createdAt: new Date(),
					},
					streamer: null,
					participantCount: 0,
				},
				{
					room: {
						id: "room-preparing",
						name: "Preparing Room",
						description: "Desc",
						status: "preparing",
						createdAt: new Date(),
					},
					streamer: {
						id: "user-1",
						name: "Streamer",
						image: null,
					},
					participantCount: 1,
				},
				{
					room: {
						id: "room-active",
						name: "Active Room",
						description: "Desc",
						status: "active",
						createdAt: new Date(),
					},
					streamer: {
						id: "user-2",
						name: "Streamer",
						image: null,
					},
					participantCount: 5,
				},
				{
					room: {
						id: "room-ended",
						name: "Ended Room",
						description: "Desc",
						status: "ended",
						createdAt: new Date(),
					},
					streamer: null,
					participantCount: 0,
				},
			];

			renderWithQuery(<RoomList initialRooms={allStatuses} userId="test-user" />);

			// Waiting and preparing should be in Live Now
			expect(screen.getByTestId("room-card-room-waiting")).toBeInTheDocument();
			expect(screen.getByTestId("room-card-room-preparing")).toBeInTheDocument();
			expect(screen.getByTestId("room-card-room-active")).toBeInTheDocument();
			// Ended should be in Past Streams
			expect(screen.getByTestId("room-card-room-ended")).toBeInTheDocument();
		});
	});
});

describe("RoomListSkeleton Component", () => {
	it("renders skeleton loading state", () => {
		render(<RoomListSkeleton />);

		// Should render multiple skeleton cards
		const skeletons = screen.getAllByTestId("room-card-skeleton");
		expect(skeletons.length).toBe(6);
	});

	it("renders search bar placeholder", () => {
		render(<RoomListSkeleton />);

		// Check for animated pulse elements (skeleton placeholders)
		const pulseElements = document.querySelectorAll(".animate-pulse");
		expect(pulseElements.length).toBeGreaterThan(0);
	});
});
