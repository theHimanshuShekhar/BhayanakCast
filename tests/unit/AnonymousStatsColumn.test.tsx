import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { render } from "../utils/render";
import { AnonymousStatsColumn } from "../../src/components/AnonymousStatsColumn";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		params,
	}: {
		children: React.ReactNode;
		to: string;
		params?: Record<string, string>;
	}) => <a href={params ? Object.values(params).reduce((h, v) => h.replace(/\$\w+/, v), to) : to}>{children}</a>,
}));

vi.mock("../../src/lib/websocket-context", () => ({
	useWebSocket: () => ({
		socket: null,
		isConnected: true,
		userCount: 42,
		userId: null,
		currentRoomId: null,
		setCurrentRoomId: vi.fn(),
		sendMessage: vi.fn(),
	}),
}));

const mockCommunityStats = {
	totalRegisteredUsers: 1500,
	totalWatchHoursThisWeek: 300,
	mostActiveStreamers: 10,
	newUsersThisWeek: 25,
	totalWatchSecondsThisWeek: 1080000,
};

const mockGlobalStats = {
	totalRoomsCreated: 5,
	totalHoursStreamedToday: 12,
	peakConcurrentUsers: 100,
};

const mockTrendingRooms = [
	{ id: "room-1", name: "Trending Room 1", streamerName: "Alice", viewerCount: 50 },
	{ id: "room-2", name: "Trending Room 2", streamerName: null, viewerCount: 30 },
];

describe("AnonymousStatsColumn", () => {
	it("renders global stats card when totalRoomsCreated > 0", () => {
		render(
			<AnonymousStatsColumn
				trendingRooms={[]}
				communityStats={mockCommunityStats}
				globalStats={mockGlobalStats}
			/>,
		);
		expect(screen.getByText("Global Stats")).toBeInTheDocument();
	});

	it("does not render global stats card when totalRoomsCreated is 0", () => {
		render(
			<AnonymousStatsColumn
				trendingRooms={[]}
				communityStats={mockCommunityStats}
				globalStats={{ ...mockGlobalStats, totalRoomsCreated: 0 }}
			/>,
		);
		expect(screen.queryByText("Global Stats")).not.toBeInTheDocument();
	});

	it("shows live user count from useWebSocket", () => {
		render(
			<AnonymousStatsColumn
				trendingRooms={[]}
				communityStats={mockCommunityStats}
				globalStats={mockGlobalStats}
			/>,
		);
		expect(screen.getByText("42")).toBeInTheDocument();
	});

	it("shows rooms created count", () => {
		render(
			<AnonymousStatsColumn
				trendingRooms={[]}
				communityStats={mockCommunityStats}
				globalStats={mockGlobalStats}
			/>,
		);
		expect(screen.getByText("5")).toBeInTheDocument();
	});

	it("renders trending rooms card when trendingRooms is non-empty", () => {
		render(
			<AnonymousStatsColumn
				trendingRooms={mockTrendingRooms}
				communityStats={mockCommunityStats}
				globalStats={mockGlobalStats}
			/>,
		);
		expect(screen.getByText("Trending Now")).toBeInTheDocument();
		expect(screen.getByText("Trending Room 1")).toBeInTheDocument();
		expect(screen.getByText("Trending Room 2")).toBeInTheDocument();
	});

	it("shows streamer name or 'No Streamer' for trending rooms", () => {
		render(
			<AnonymousStatsColumn
				trendingRooms={mockTrendingRooms}
				communityStats={mockCommunityStats}
				globalStats={mockGlobalStats}
			/>,
		);
		expect(screen.getByText("Alice")).toBeInTheDocument();
		expect(screen.getByText("No Streamer")).toBeInTheDocument();
	});

	it("does not render trending rooms card when list is empty", () => {
		render(
			<AnonymousStatsColumn
				trendingRooms={[]}
				communityStats={mockCommunityStats}
				globalStats={mockGlobalStats}
			/>,
		);
		expect(screen.queryByText("Trending Now")).not.toBeInTheDocument();
	});

	it("renders CommunityStatsCard when totalRegisteredUsers > 0", () => {
		render(
			<AnonymousStatsColumn
				trendingRooms={[]}
				communityStats={mockCommunityStats}
				globalStats={mockGlobalStats}
			/>,
		);
		expect(screen.getByText("Community")).toBeInTheDocument();
	});

	it("does not render CommunityStatsCard when totalRegisteredUsers is 0", () => {
		render(
			<AnonymousStatsColumn
				trendingRooms={[]}
				communityStats={{ ...mockCommunityStats, totalRegisteredUsers: 0 }}
				globalStats={mockGlobalStats}
			/>,
		);
		// "Community" heading from CommunityStatsCard should be absent
		expect(screen.queryByText("Community")).not.toBeInTheDocument();
	});

	it("renders the Join BhayanakCast call-to-action section", () => {
		render(
			<AnonymousStatsColumn
				trendingRooms={[]}
				communityStats={mockCommunityStats}
				globalStats={mockGlobalStats}
			/>,
		);
		expect(screen.getByText("Join BhayanakCast")).toBeInTheDocument();
		expect(screen.getByText("Get Started")).toBeInTheDocument();
	});
});
