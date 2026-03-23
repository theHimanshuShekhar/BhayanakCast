import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Chat, type ChatMessage } from "#/components/Chat";
import { useWebSocket } from "#/lib/websocket-context";

// Mock the websocket context
vi.mock("#/lib/websocket-context", () => ({
	useWebSocket: vi.fn(),
}));

describe("Chat Component", () => {
	const mockSocket = {
		on: vi.fn(),
		off: vi.fn(),
		emit: vi.fn(),
	};

	const mockOn = vi.fn();
	const mockOff = vi.fn();
	const mockEmit = vi.fn();

	beforeEach(() => {
		mockOn.mockClear();
		mockOff.mockClear();
		mockEmit.mockClear();
		mockSocket.on.mockClear();
		mockSocket.off.mockClear();
		mockSocket.emit.mockClear();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("Initial State", () => {
		it("renders empty state when no messages", () => {
			vi.mocked(useWebSocket).mockReturnValue({
				socket: mockSocket as any,
				isConnected: true,
				userCount: 1,
				userId: "test-user",
				currentRoomId: "room-1",
				setCurrentRoomId: vi.fn(),
				sendMessage: vi.fn(),
			});

			render(<Chat roomId="room-1" userId="test-user" userName="Test User" />);

			expect(screen.getByText("No messages yet")).toBeInTheDocument();
			expect(screen.getByText("Be the first to say something!")).toBeInTheDocument();
		});

		it("shows connecting message when socket is not connected", () => {
			vi.mocked(useWebSocket).mockReturnValue({
				socket: mockSocket as any,
				isConnected: false,
				userCount: 1,
				userId: "test-user",
				currentRoomId: "room-1",
				setCurrentRoomId: vi.fn(),
				sendMessage: vi.fn(),
			});

			render(<Chat roomId="room-1" userId="test-user" userName="Test User" />);

			expect(screen.getByText("Connecting to chat...")).toBeInTheDocument();
		});

		it("shows sign in message when userId is not provided", () => {
			vi.mocked(useWebSocket).mockReturnValue({
				socket: mockSocket as any,
				isConnected: true,
				userCount: 1,
				userId: null,
				currentRoomId: "room-1",
				setCurrentRoomId: vi.fn(),
				sendMessage: vi.fn(),
			});

			render(<Chat roomId="room-1" />);

			expect(screen.getByText("Sign in to chat")).toBeInTheDocument();
		});
	});

	describe("Message Input", () => {
		it("renders input field with placeholder", () => {
			vi.mocked(useWebSocket).mockReturnValue({
				socket: mockSocket as any,
				isConnected: true,
				userCount: 1,
				userId: "test-user",
				currentRoomId: "room-1",
				setCurrentRoomId: vi.fn(),
				sendMessage: vi.fn(),
			});

			render(<Chat roomId="room-1" userId="test-user" userName="Test User" />);

			expect(screen.getByPlaceholderText("Type a message...")).toBeInTheDocument();
		});

		it("disables submit button when input is empty", () => {
			vi.mocked(useWebSocket).mockReturnValue({
				socket: mockSocket as any,
				isConnected: true,
				userCount: 1,
				userId: "test-user",
				currentRoomId: "room-1",
				setCurrentRoomId: vi.fn(),
				sendMessage: vi.fn(),
			});

			render(<Chat roomId="room-1" userId="test-user" userName="Test User" />);

			const submitButton = screen.getByRole("button");
			expect(submitButton).toBeDisabled();
		});

		it("enables submit button when input has text", async () => {
			vi.mocked(useWebSocket).mockReturnValue({
				socket: mockSocket as any,
				isConnected: true,
				userCount: 1,
				userId: "test-user",
				currentRoomId: "room-1",
				setCurrentRoomId: vi.fn(),
				sendMessage: vi.fn(),
			});

			render(<Chat roomId="room-1" userId="test-user" userName="Test User" />);

			const input = screen.getByPlaceholderText("Type a message...");
			await userEvent.type(input, "Hello");

			const submitButton = screen.getByRole("button");
			expect(submitButton).not.toBeDisabled();
		});

		it("enforces max length of 500 characters", () => {
			vi.mocked(useWebSocket).mockReturnValue({
				socket: mockSocket as any,
				isConnected: true,
				userCount: 1,
				userId: "test-user",
				currentRoomId: "room-1",
				setCurrentRoomId: vi.fn(),
				sendMessage: vi.fn(),
			});

			render(<Chat roomId="room-1" userId="test-user" userName="Test User" />);

			const input = screen.getByPlaceholderText("Type a message...") as HTMLInputElement;
			expect(input.maxLength).toBe(500);
		});
	});

	describe("Sending Messages", () => {
		it("emits chat:send event when form is submitted", async () => {
			vi.mocked(useWebSocket).mockReturnValue({
				socket: mockSocket as any,
				isConnected: true,
				userCount: 1,
				userId: "test-user",
				currentRoomId: "room-1",
				setCurrentRoomId: vi.fn(),
				sendMessage: vi.fn(),
			});

			render(<Chat roomId="room-1" userId="test-user" userName="Test User" />);

			const input = screen.getByPlaceholderText("Type a message...");
			await userEvent.type(input, "Hello World");

			const form = input.closest("form");
			fireEvent.submit(form!);

			expect(mockSocket.emit).toHaveBeenCalledWith("chat:send", {
				roomId: "room-1",
				content: "Hello World",
				userName: "Test User",
				userImage: undefined,
			});
		});

		it("clears input after sending message", async () => {
			vi.mocked(useWebSocket).mockReturnValue({
				socket: mockSocket as any,
				isConnected: true,
				userCount: 1,
				userId: "test-user",
				currentRoomId: "room-1",
				setCurrentRoomId: vi.fn(),
				sendMessage: vi.fn(),
			});

			render(<Chat roomId="room-1" userId="test-user" userName="Test User" />);

			const input = screen.getByPlaceholderText("Type a message...") as HTMLInputElement;
			await userEvent.type(input, "Hello World");
			
			const form = input.closest("form");
			fireEvent.submit(form!);

			await waitFor(() => {
				expect(input.value).toBe("");
			});
		});

		it("does not send message when socket is not connected", async () => {
			vi.mocked(useWebSocket).mockReturnValue({
				socket: mockSocket as any,
				isConnected: false,
				userCount: 1,
				userId: "test-user",
				currentRoomId: "room-1",
				setCurrentRoomId: vi.fn(),
				sendMessage: vi.fn(),
			});

			render(<Chat roomId="room-1" userId="test-user" userName="Test User" />);

			expect(screen.getByText("Connecting to chat...")).toBeInTheDocument();
			expect(mockSocket.emit).not.toHaveBeenCalled();
		});

		it("does not send message when userId is not provided", async () => {
			vi.mocked(useWebSocket).mockReturnValue({
				socket: mockSocket as any,
				isConnected: true,
				userCount: 1,
				userId: null,
				currentRoomId: "room-1",
				setCurrentRoomId: vi.fn(),
				sendMessage: vi.fn(),
			});

			render(<Chat roomId="room-1" userName="Test User" />);

			expect(screen.getByText("Sign in to chat")).toBeInTheDocument();
			expect(mockSocket.emit).not.toHaveBeenCalled();
		});

		it("trims whitespace from message before sending", async () => {
			vi.mocked(useWebSocket).mockReturnValue({
				socket: mockSocket as any,
				isConnected: true,
				userCount: 1,
				userId: "test-user",
				currentRoomId: "room-1",
				setCurrentRoomId: vi.fn(),
				sendMessage: vi.fn(),
			});

			render(<Chat roomId="room-1" userId="test-user" userName="Test User" />);

			const input = screen.getByPlaceholderText("Type a message...");
			await userEvent.type(input, "  Hello World  ");

			const form = input.closest("form");
			fireEvent.submit(form!);

			expect(mockSocket.emit).toHaveBeenCalledWith("chat:send", {
				roomId: "room-1",
				content: "Hello World",
				userName: "Test User",
				userImage: undefined,
			});
		});

		it("does not send empty messages", async () => {
			vi.mocked(useWebSocket).mockReturnValue({
				socket: mockSocket as any,
				isConnected: true,
				userCount: 1,
				userId: "test-user",
				currentRoomId: "room-1",
				setCurrentRoomId: vi.fn(),
				sendMessage: vi.fn(),
			});

			render(<Chat roomId="room-1" userId="test-user" userName="Test User" />);

			const input = screen.getByPlaceholderText("Type a message...");
			await userEvent.type(input, "   ");

			const submitButton = screen.getByRole("button");
			expect(submitButton).toBeDisabled();
			expect(mockSocket.emit).not.toHaveBeenCalled();
		});
	});

	describe("Receiving Messages", () => {
		it("displays user message when received", async () => {
			let messageHandler: ((message: ChatMessage) => void) | null = null;

			mockSocket.on.mockImplementation((event: string, handler: any) => {
				if (event === "chat:message") {
					messageHandler = handler;
				}
			});

			vi.mocked(useWebSocket).mockReturnValue({
				socket: mockSocket as any,
				isConnected: true,
				userCount: 1,
				userId: "test-user",
				currentRoomId: "room-1",
				setCurrentRoomId: vi.fn(),
				sendMessage: vi.fn(),
			});

			render(<Chat roomId="room-1" userId="test-user" userName="Test User" />);

			// Simulate receiving a message
			const testMessage: ChatMessage = {
				id: "msg-1",
				roomId: "room-1",
				userId: "other-user",
				userName: "Other User",
				content: "Hello there!",
				timestamp: Date.now(),
				type: "user",
			};

			if (messageHandler) {
				messageHandler(testMessage);
			}

			await waitFor(() => {
				expect(screen.getByText("Hello there!")).toBeInTheDocument();
			});

			expect(screen.getByText("Other User")).toBeInTheDocument();
		});

		it("displays own message differently from others", async () => {
			let messageHandler: ((message: ChatMessage) => void) | null = null;

			mockSocket.on.mockImplementation((event: string, handler: any) => {
				if (event === "chat:message") {
					messageHandler = handler;
				}
			});

			vi.mocked(useWebSocket).mockReturnValue({
				socket: mockSocket as any,
				isConnected: true,
				userCount: 1,
				userId: "test-user",
				currentRoomId: "room-1",
				setCurrentRoomId: vi.fn(),
				sendMessage: vi.fn(),
			});

			render(<Chat roomId="room-1" userId="test-user" userName="Test User" />);

			// Simulate receiving own message
			const ownMessage: ChatMessage = {
				id: "msg-1",
				roomId: "room-1",
				userId: "test-user",
				userName: "Test User",
				content: "My message",
				timestamp: Date.now(),
				type: "user",
			};

			if (messageHandler) {
				messageHandler(ownMessage);
			}

			await waitFor(() => {
				expect(screen.getByText("My message")).toBeInTheDocument();
			});
		});

		it("ignores messages from other rooms", async () => {
			let messageHandler: ((message: ChatMessage) => void) | null = null;

			mockSocket.on.mockImplementation((event: string, handler: any) => {
				if (event === "chat:message") {
					messageHandler = handler;
				}
			});

			vi.mocked(useWebSocket).mockReturnValue({
				socket: mockSocket as any,
				isConnected: true,
				userCount: 1,
				userId: "test-user",
				currentRoomId: "room-1",
				setCurrentRoomId: vi.fn(),
				sendMessage: vi.fn(),
			});

			render(<Chat roomId="room-1" userId="test-user" userName="Test User" />);

			// Simulate receiving a message from different room
			const otherRoomMessage: ChatMessage = {
				id: "msg-1",
				roomId: "room-2",
				userId: "other-user",
				userName: "Other User",
				content: "Wrong room message",
				timestamp: Date.now(),
				type: "user",
			};

			if (messageHandler) {
				messageHandler(otherRoomMessage);
			}

			// Message should not appear
			expect(screen.queryByText("Wrong room message")).not.toBeInTheDocument();
			expect(screen.getByText("No messages yet")).toBeInTheDocument();
		});
	});

	describe("System Messages", () => {
		it("displays participant joined message", async () => {
			let joinedHandler: ((data: any) => void) | null = null;

			mockSocket.on.mockImplementation((event: string, handler: any) => {
				if (event === "room:participant_joined") {
					joinedHandler = handler;
				}
			});

			vi.mocked(useWebSocket).mockReturnValue({
				socket: mockSocket as any,
				isConnected: true,
				userCount: 1,
				userId: "test-user",
				currentRoomId: "room-1",
				setCurrentRoomId: vi.fn(),
				sendMessage: vi.fn(),
			});

			render(<Chat roomId="room-1" userId="test-user" userName="Test User" />);

			if (joinedHandler) {
				joinedHandler({
					userId: "new-user",
					userName: "New User",
					participantCount: 2,
				});
			}

			await waitFor(() => {
				expect(screen.getByText("New User joined the room")).toBeInTheDocument();
			});
		});

		it("displays participant left message", async () => {
			let leftHandler: ((data: any) => void) | null = null;

			mockSocket.on.mockImplementation((event: string, handler: any) => {
				if (event === "room:participant_left") {
					leftHandler = handler;
				}
			});

			vi.mocked(useWebSocket).mockReturnValue({
				socket: mockSocket as any,
				isConnected: true,
				userCount: 1,
				userId: "test-user",
				currentRoomId: "room-1",
				setCurrentRoomId: vi.fn(),
				sendMessage: vi.fn(),
			});

			render(<Chat roomId="room-1" userId="test-user" userName="Test User" />);

			if (leftHandler) {
				leftHandler({
					userId: "leaving-user",
					userName: "Leaving User",
					participantCount: 1,
				});
			}

			await waitFor(() => {
				expect(screen.getByText("Leaving User left the room")).toBeInTheDocument();
			});
		});

		it("does not show own join/leave messages", async () => {
			let joinedHandler: ((data: any) => void) | null = null;

			mockSocket.on.mockImplementation((event: string, handler: any) => {
				if (event === "room:participant_joined") {
					joinedHandler = handler;
				}
			});

			vi.mocked(useWebSocket).mockReturnValue({
				socket: mockSocket as any,
				isConnected: true,
				userCount: 1,
				userId: "test-user",
				currentRoomId: "room-1",
				setCurrentRoomId: vi.fn(),
				sendMessage: vi.fn(),
			});

			render(<Chat roomId="room-1" userId="test-user" userName="Test User" />);

			if (joinedHandler) {
				joinedHandler({
					userId: "test-user", // Same as current user
					userName: "Test User",
					participantCount: 1,
				});
			}

			// Should still show empty state
			expect(screen.getByText("No messages yet")).toBeInTheDocument();
		});

		it("displays room status change messages", async () => {
			let statusHandler: ((data: any) => void) | null = null;

			mockSocket.on.mockImplementation((event: string, handler: any) => {
				if (event === "room:status_changed") {
					statusHandler = handler;
				}
			});

			vi.mocked(useWebSocket).mockReturnValue({
				socket: mockSocket as any,
				isConnected: true,
				userCount: 1,
				userId: "test-user",
				currentRoomId: "room-1",
				setCurrentRoomId: vi.fn(),
				sendMessage: vi.fn(),
			});

			render(<Chat roomId="room-1" userId="test-user" userName="Test User" />);

			if (statusHandler) {
				statusHandler({ status: "active" });
			}

			await waitFor(() => {
				expect(screen.getByText("Stream is now live!")).toBeInTheDocument();
			});
		});

		it("does not display ended status message", async () => {
			let statusHandler: ((data: any) => void) | null = null;

			mockSocket.on.mockImplementation((event: string, handler: any) => {
				if (event === "room:status_changed") {
					statusHandler = handler;
				}
			});

			vi.mocked(useWebSocket).mockReturnValue({
				socket: mockSocket as any,
				isConnected: true,
				userCount: 1,
				userId: "test-user",
				currentRoomId: "room-1",
				setCurrentRoomId: vi.fn(),
				sendMessage: vi.fn(),
			});

			render(<Chat roomId="room-1" userId="test-user" userName="Test User" />);

			if (statusHandler) {
				statusHandler({ status: "ended" });
			}

			// Should still show empty state
			expect(screen.getByText("No messages yet")).toBeInTheDocument();
		});
	});

	describe("Cleanup", () => {
		it("removes event listeners on unmount", () => {
			vi.mocked(useWebSocket).mockReturnValue({
				socket: mockSocket as any,
				isConnected: true,
				userCount: 1,
				userId: "test-user",
				currentRoomId: "room-1",
				setCurrentRoomId: vi.fn(),
				sendMessage: vi.fn(),
			});

			const { unmount } = render(<Chat roomId="room-1" userId="test-user" userName="Test User" />);

			unmount();

			expect(mockSocket.off).toHaveBeenCalledWith("chat:message", expect.any(Function));
			expect(mockSocket.off).toHaveBeenCalledWith("room:participant_joined", expect.any(Function));
			expect(mockSocket.off).toHaveBeenCalledWith("room:participant_left", expect.any(Function));
			expect(mockSocket.off).toHaveBeenCalledWith("room:status_changed", expect.any(Function));
		});
	});

	describe("User Image Display", () => {
		it("displays user image when available", async () => {
			let messageHandler: ((message: ChatMessage) => void) | null = null;

			mockSocket.on.mockImplementation((event: string, handler: any) => {
				if (event === "chat:message") {
					messageHandler = handler;
				}
			});

			vi.mocked(useWebSocket).mockReturnValue({
				socket: mockSocket as any,
				isConnected: true,
				userCount: 1,
				userId: "test-user",
				currentRoomId: "room-1",
				setCurrentRoomId: vi.fn(),
				sendMessage: vi.fn(),
			});

			render(<Chat roomId="room-1" userId="test-user" userName="Test User" />);

			const testMessage: ChatMessage = {
				id: "msg-1",
				roomId: "room-1",
				userId: "other-user",
				userName: "Other User",
				userImage: "https://example.com/avatar.jpg",
				content: "Hello!",
				timestamp: Date.now(),
				type: "user",
			};

			if (messageHandler) {
				messageHandler(testMessage);
			}

			await waitFor(() => {
				const img = screen.getByAltText("Other User");
				expect(img).toBeInTheDocument();
				expect(img).toHaveAttribute("src", "https://example.com/avatar.jpg");
			});
		});

		it("displays default avatar when user image is not available", async () => {
			let messageHandler: ((message: ChatMessage) => void) | null = null;

			mockSocket.on.mockImplementation((event: string, handler: any) => {
				if (event === "chat:message") {
					messageHandler = handler;
				}
			});

			vi.mocked(useWebSocket).mockReturnValue({
				socket: mockSocket as any,
				isConnected: true,
				userCount: 1,
				userId: "test-user",
				currentRoomId: "room-1",
				setCurrentRoomId: vi.fn(),
				sendMessage: vi.fn(),
			});

			render(<Chat roomId="room-1" userId="test-user" userName="Test User" />);

			const testMessage: ChatMessage = {
				id: "msg-1",
				roomId: "room-1",
				userId: "other-user",
				userName: "Other User",
				content: "Hello!",
				timestamp: Date.now(),
				type: "user",
			};

			if (messageHandler) {
				messageHandler(testMessage);
			}

			await waitFor(() => {
				// Should show User icon for default avatar
				expect(screen.getByText("Hello!")).toBeInTheDocument();
			});
		});
	});

	describe("Time Formatting", () => {
		it("formats message timestamp correctly", async () => {
			let messageHandler: ((message: ChatMessage) => void) | null = null;

			mockSocket.on.mockImplementation((event: string, handler: any) => {
				if (event === "chat:message") {
					messageHandler = handler;
				}
			});

			vi.mocked(useWebSocket).mockReturnValue({
				socket: mockSocket as any,
				isConnected: true,
				userCount: 1,
				userId: "test-user",
				currentRoomId: "room-1",
				setCurrentRoomId: vi.fn(),
				sendMessage: vi.fn(),
			});

			render(<Chat roomId="room-1" userId="test-user" userName="Test User" />);

			const testMessage: ChatMessage = {
				id: "msg-1",
				roomId: "room-1",
				userId: "other-user",
				userName: "Other User",
				content: "Hello!",
				timestamp: new Date("2024-01-15T14:30:00").getTime(),
				type: "user",
			};

			if (messageHandler) {
				messageHandler(testMessage);
			}

			await waitFor(() => {
				// Should display time in HH:MM format
				expect(screen.getByText(/\d{1,2}:\d{2}/)).toBeInTheDocument();
			});
		});
	});
});
