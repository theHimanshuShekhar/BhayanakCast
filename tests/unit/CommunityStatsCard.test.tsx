import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { render } from "../utils/render";
import { CommunityStatsCard } from "../../src/components/CommunityStatsCard";

describe("CommunityStatsCard", () => {
	const mockStats = {
		totalRegisteredUsers: 1000,
		totalWatchHoursThisWeek: 500,
		mostActiveStreamers: 25,
		newUsersThisWeek: 50,
	};

	it("renders all stat categories", () => {
		render(<CommunityStatsCard stats={mockStats} />);

		expect(screen.getByText("Total Users")).toBeInTheDocument();
		expect(screen.getByText("Watch Time (Week)")).toBeInTheDocument();
		expect(screen.getByText("Active Streamers")).toBeInTheDocument();
		expect(screen.getByText("New This Week")).toBeInTheDocument();
	});

	it("formats numbers with commas", () => {
		render(<CommunityStatsCard stats={mockStats} />);
		expect(screen.getByText("1,000")).toBeInTheDocument();
	});

	it("shows loading skeleton when isLoading", () => {
		render(<CommunityStatsCard isLoading={true} />);
		expect(document.querySelector(".animate-pulse")).toBeInTheDocument();
	});

	it("handles missing stats gracefully", () => {
		render(<CommunityStatsCard stats={undefined} />);
		expect(screen.getByText("Community")).toBeInTheDocument();
	});

	it("displays correct icons for each stat", () => {
		const { container } = render(<CommunityStatsCard stats={mockStats} />);
		const icons = container.querySelectorAll("svg");
		expect(icons.length).toBeGreaterThan(0);
	});

	it("updates when stats change", () => {
		const { rerender } = render(<CommunityStatsCard stats={mockStats} />);
		expect(screen.getByText("1,000")).toBeInTheDocument();

		const newStats = { ...mockStats, totalRegisteredUsers: 2000 };
		rerender(<CommunityStatsCard stats={newStats} />);
		expect(screen.getByText("2,000")).toBeInTheDocument();
	});
});
