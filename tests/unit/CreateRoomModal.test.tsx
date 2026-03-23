import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../utils/render";
import { CreateRoomModal } from "../../src/components/CreateRoomModal";

const mockNavigate = vi.fn();
const mockEmit = vi.fn();
const mockOn = vi.fn();
const mockOff = vi.fn();
const mockSetCurrentRoomId = vi.fn();

// Mock WebSocket context
vi.mock("#/lib/websocket-context", () => ({
	useWebSocket: () => ({
		socket: {
			emit: mockEmit,
			on: mockOn,
			off: mockOff,
		},
		isConnected: true,
		userCount: 1,
		userId: "test-user",
		currentRoomId: null,
		setCurrentRoomId: mockSetCurrentRoomId,
		sendMessage: vi.fn(),
	}),
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => mockNavigate,
	Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

describe("CreateRoomModal", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("opens modal on button click", async () => {
		const user = userEvent.setup();
		render(
			<CreateRoomModal>
				<button type="button">Open Create Room</button>
			</CreateRoomModal>,
		);

		await user.click(screen.getByText("Open Create Room"));
		expect(screen.getByText("Create New Room")).toBeInTheDocument();
	});

	it("displays form fields", async () => {
		const user = userEvent.setup();
		render(
			<CreateRoomModal>
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
			<CreateRoomModal>
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
			<CreateRoomModal>
				<button type="button">Open Create Room</button>
			</CreateRoomModal>,
		);

		await userEvent.click(screen.getByText("Open Create Room"));
		const submitButton = screen.getByRole("button", { name: /create room/i });
		expect(submitButton).toBeDisabled();
	});

	it("emits room:create on submit", async () => {
		const user = userEvent.setup();
		render(
			<CreateRoomModal>
				<button type="button">Open Create Room</button>
			</CreateRoomModal>,
		);

		await user.click(screen.getByText("Open Create Room"));
		const nameInput = screen.getByLabelText("Room Name");
		await user.type(nameInput, "Test Room");

		const submitButton = screen.getByRole("button", { name: /create room/i });
		await user.click(submitButton);

		expect(mockEmit).toHaveBeenCalledWith("room:create", {
			name: "Test Room",
			description: undefined,
		});
	});

	it("closes modal on cancel", async () => {
		const user = userEvent.setup();
		render(
			<CreateRoomModal>
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
			<CreateRoomModal>
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
