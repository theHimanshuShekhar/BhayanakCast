import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../utils/render";
import { CreateRoomModal } from "../../src/components/CreateRoomModal";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => mockNavigate,
	Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

vi.mock("../../src/utils/rooms", () => ({
	createRoom: vi.fn(),
}));

describe("CreateRoomModal", () => {
	const mockUserId = "user-1";

	it("opens modal on button click", async () => {
		const user = userEvent.setup();
		render(
			<CreateRoomModal userId={mockUserId}>
				<button type="button">Open Create Room</button>
			</CreateRoomModal>,
		);

		await user.click(screen.getByText("Open Create Room"));
		expect(screen.getByText("Create New Room")).toBeInTheDocument();
	});

	it("displays form fields", async () => {
		const user = userEvent.setup();
		render(
			<CreateRoomModal userId={mockUserId}>
				<button type="button">Open Create Room</button>
			</CreateRoomModal>,
		);

		await user.click(screen.getByText("Open Create Room"));
		expect(screen.getByLabelText("Room Name")).toBeInTheDocument();
		expect(screen.getByLabelText("Description (Optional)")).toBeInTheDocument();
	});

	it("shows character count for room name", async () => {
		const user = userEvent.setup();
		render(
			<CreateRoomModal userId={mockUserId}>
				<button type="button">Open Create Room</button>
			</CreateRoomModal>,
		);

		await user.click(screen.getByText("Open Create Room"));
		const nameInput = screen.getByLabelText("Room Name");
		await user.type(nameInput, "Test");

		expect(screen.getByText("4/100 characters")).toBeInTheDocument();
	});

	it("disables submit when name is empty", async () => {
		render(
			<CreateRoomModal userId={mockUserId}>
				<button type="button">Open Create Room</button>
			</CreateRoomModal>,
		);

		await userEvent.click(screen.getByText("Open Create Room"));
		const submitButton = screen.getByRole("button", { name: /create room/i });
		expect(submitButton).toBeDisabled();
	});

	it("closes modal on cancel", async () => {
		const user = userEvent.setup();
		render(
			<CreateRoomModal userId={mockUserId}>
				<button type="button">Open Create Room</button>
			</CreateRoomModal>,
		);

		await user.click(screen.getByText("Open Create Room"));
		await user.click(screen.getByText("Cancel"));

		await waitFor(() => {
			expect(
				screen.queryByText("Create New Room"),
			).not.toBeInTheDocument();
		});
	});

	it("closes modal on X button click", async () => {
		const user = userEvent.setup();
		render(
			<CreateRoomModal userId={mockUserId}>
				<button type="button">Open Create Room</button>
			</CreateRoomModal>,
		);

		await user.click(screen.getByText("Open Create Room"));
		const closeButton = screen.getByRole("button", { name: /close/i });
		await user.click(closeButton);

		await waitFor(() => {
			expect(
				screen.queryByText("Create New Room"),
			).not.toBeInTheDocument();
		});
	});
});
