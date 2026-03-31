import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, act, fireEvent } from "@testing-library/react";
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

	it("shows error when description exceeds 500 characters", async () => {
		const user = userEvent.setup();
		render(
			<CreateRoomModal>
				<button type="button">Open Create Room</button>
			</CreateRoomModal>,
		);

		await user.click(screen.getByText("Open Create Room"));
		await user.type(screen.getByLabelText("Room Name"), "Test Room");
		// maxLength=500 blocks userEvent.type beyond limit; use fireEvent to bypass
		fireEvent.change(screen.getByLabelText("Description (Optional)"), {
			target: { value: "a".repeat(501) },
		});

		await user.click(screen.getByRole("button", { name: /^create room$/i }));

		expect(
			screen.getByText("Description must be less than 500 characters"),
		).toBeInTheDocument();
		expect(mockEmit).not.toHaveBeenCalled();
	});

	it("navigates to room page when room:created socket event fires", async () => {
		const user = userEvent.setup();
		render(
			<CreateRoomModal>
				<button type="button">Open Create Room</button>
			</CreateRoomModal>,
		);

		// Handlers are registered on mount — capture them before opening modal
		const roomCreatedHandler = mockOn.mock.calls.find(
			([event]: [string]) => event === "room:created",
		)?.[1] as ((data: unknown) => void) | undefined;

		// Open modal so the component is in "active" state
		await user.click(screen.getByText("Open Create Room"));

		act(() => {
			roomCreatedHandler?.({
				room: {
					id: "new-room-id",
					name: "New Room",
					description: "",
					status: "waiting",
					streamerId: null,
					createdAt: new Date(),
				},
				participant: {
					userId: "test-user",
					userName: "Test User",
					joinedAt: new Date(),
					isStreamer: true,
				},
			});
		});

		expect(mockSetCurrentRoomId).toHaveBeenCalledWith("new-room-id");
		expect(mockNavigate).toHaveBeenCalledWith({
			to: "/room/$roomId",
			params: { roomId: "new-room-id" },
		});
	});

	it("shows error message when room:create_error socket event fires", async () => {
		const user = userEvent.setup();
		render(
			<CreateRoomModal>
				<button type="button">Open Create Room</button>
			</CreateRoomModal>,
		);

		const createErrorHandler = mockOn.mock.calls.find(
			([event]: [string]) => event === "room:create_error",
		)?.[1] as ((data: { message: string }) => void) | undefined;

		// Modal must be open for the error element to be in the DOM
		await user.click(screen.getByText("Open Create Room"));

		act(() => {
			createErrorHandler?.({ message: "Room name already in use" });
		});

		expect(screen.getByText("Room name already in use")).toBeInTheDocument();
	});

	it("shows 'Room name must be at least 3 characters' for short names", async () => {
		const user = userEvent.setup();
		render(
			<CreateRoomModal>
				<button type="button">Open Create Room</button>
			</CreateRoomModal>,
		);

		await user.click(screen.getByText("Open Create Room"));
		await user.type(screen.getByLabelText("Room Name"), "AB");
		await user.click(screen.getByRole("button", { name: /^create room$/i }));

		expect(
			screen.getByText("Room name must be at least 3 characters"),
		).toBeInTheDocument();
		expect(mockEmit).not.toHaveBeenCalled();
	});

	it("shows error when room name exceeds 100 characters", async () => {
		const user = userEvent.setup();
		render(
			<CreateRoomModal>
				<button type="button">Open Create Room</button>
			</CreateRoomModal>,
		);

		await user.click(screen.getByText("Open Create Room"));
		fireEvent.change(screen.getByLabelText("Room Name"), {
			target: { value: "a".repeat(101) },
		});
		await user.click(screen.getByRole("button", { name: /^create room$/i }));

		expect(
			screen.getByText("Room name must be less than 100 characters"),
		).toBeInTheDocument();
		expect(mockEmit).not.toHaveBeenCalled();
	});

	it("renders default 'Create Room' button when no children provided", () => {
		render(<CreateRoomModal />);
		expect(screen.getByText("Create Room")).toBeInTheDocument();
	});

	it("cleans up socket listeners on unmount", () => {
		const { unmount } = render(
			<CreateRoomModal>
				<button type="button">Open</button>
			</CreateRoomModal>,
		);
		unmount();
		expect(mockOff).toHaveBeenCalledWith("room:created", expect.any(Function));
		expect(mockOff).toHaveBeenCalledWith("room:create_error", expect.any(Function));
	});
});
