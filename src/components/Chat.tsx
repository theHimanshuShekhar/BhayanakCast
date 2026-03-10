import { Send, User } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWebSocket } from "#/lib/websocket-context";

export interface ChatMessage {
	id: string;
	roomId: string;
	userId: string;
	userName: string;
	userImage?: string | null;
	content: string;
	timestamp: number;
	type: "user" | "system";
}

interface ChatProps {
	roomId: string;
	userId?: string;
	userName?: string;
	userImage?: string | null;
}

function formatTime(timestamp: number): string {
	const date = new Date(timestamp);
	return date.toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function Chat({ roomId, userId, userName, userImage }: ChatProps) {
	const { socket, isConnected } = useWebSocket();
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [inputMessage, setInputMessage] = useState("");
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const chatContainerRef = useRef<HTMLDivElement>(null);

	// Scroll to bottom when new messages arrive
	const scrollToBottom = useCallback(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, []);

	useEffect(() => {
		scrollToBottom();
	}, [scrollToBottom]);

	// Listen for chat messages
	useEffect(() => {
		if (!socket || !isConnected) return;

		const handleChatMessage = (message: ChatMessage) => {
			if (message.roomId === roomId) {
				setMessages((prev) => [...prev, message]);
			}
		};

		socket.on("chat:message", handleChatMessage);

		return () => {
			socket.off("chat:message", handleChatMessage);
		};
	}, [socket, isConnected, roomId]);

	// Send chat message
	const sendMessage = useCallback(
		(e: React.FormEvent) => {
			e.preventDefault();

			if (!socket || !isConnected || !inputMessage.trim() || !userId) {
				return;
			}

			socket.emit("chat:send", {
				roomId,
				content: inputMessage.trim(),
				userName: userName || userId,
				userImage,
			});

			setInputMessage("");
		},
		[socket, isConnected, inputMessage, roomId, userId, userName, userImage],
	);

	// Listen for room events (join/leave) from the room page
	useEffect(() => {
		if (!socket || !isConnected) return;

		const handleParticipantJoined = (data: {
			userId: string;
			userName: string;
			participantCount: number;
		}) => {
			if (data.userId !== userId) {
				const systemMessage: ChatMessage = {
					id: `system-join-${Date.now()}`,
					roomId,
					userId: "system",
					userName: "System",
					content: `${data.userName} joined the room`,
					timestamp: Date.now(),
					type: "system",
				};
				setMessages((prev) => [...prev, systemMessage]);
			}
		};

		const handleParticipantLeft = (data: {
			userId: string;
			userName: string;
			participantCount: number;
		}) => {
			if (data.userId !== userId) {
				const systemMessage: ChatMessage = {
					id: `system-leave-${Date.now()}`,
					roomId,
					userId: "system",
					userName: "System",
					content: `${data.userName} left the room`,
					timestamp: Date.now(),
					type: "system",
				};
				setMessages((prev) => [...prev, systemMessage]);
			}
		};

		const handleStatusChanged = (data: { status: string }) => {
			// Skip showing "Room has ended" message
			if (data.status === "ended") {
				return;
			}

			let statusMessage = "";
			switch (data.status) {
				case "waiting":
					statusMessage = "Room is now waiting for participants";
					break;
				case "preparing":
					statusMessage = "Room is preparing for stream";
					break;
				case "active":
					statusMessage = "Stream is now live!";
					break;
				default:
					statusMessage = `Room status changed to ${data.status}`;
			}

			const systemMessage: ChatMessage = {
				id: `system-status-${Date.now()}`,
				roomId,
				userId: "system",
				userName: "System",
				content: statusMessage,
				timestamp: Date.now(),
				type: "system",
			};
			setMessages((prev) => [...prev, systemMessage]);
		};

		socket.on("room:participant_joined", handleParticipantJoined);
		socket.on("room:participant_left", handleParticipantLeft);
		socket.on("room:status_changed", handleStatusChanged);

		return () => {
			socket.off("room:participant_joined", handleParticipantJoined);
			socket.off("room:participant_left", handleParticipantLeft);
			socket.off("room:status_changed", handleStatusChanged);
		};
	}, [socket, isConnected, roomId, userId]);

	return (
		<div className="flex flex-col h-full bg-depth-1">
			{/* Messages Container */}
			<div
				ref={chatContainerRef}
				className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0"
			>
				{messages.length === 0 ? (
					<div className="flex flex-col items-center justify-center h-full text-center text-text-tertiary">
						<p className="text-sm">No messages yet</p>
						<p className="text-xs mt-1">Be the first to say something!</p>
					</div>
				) : (
					<>
						{messages.map((message) => (
							<div
								key={message.id}
								className={`flex gap-2 ${
									message.type === "system"
										? "justify-center"
										: message.userId === userId
											? "justify-end"
											: "justify-start"
								}`}
							>
								{message.type === "system" ? (
									<div className="bg-depth-2 px-3 py-1.5 rounded-full text-xs text-text-tertiary max-w-[90%]">
										{message.content}
									</div>
								) : (
									<div
										className={`flex gap-2 max-w-[85%] ${
											message.userId === userId ? "flex-row-reverse" : ""
										}`}
									>
										{/* Avatar */}
										<div className="shrink-0">
											{message.userImage ? (
												<img
													src={message.userImage}
													alt={message.userName}
													className="w-8 h-8 rounded-full object-cover"
												/>
											) : (
												<div className="w-8 h-8 rounded-full bg-surface-3 flex items-center justify-center">
													<User className="w-4 h-4 text-text-secondary" />
												</div>
											)}
										</div>

										{/* Message Bubble */}
										<div
											className={`flex flex-col ${
												message.userId === userId ? "items-end" : "items-start"
											}`}
										>
											<div
												className={`px-3 py-2 rounded-xl ${
													message.userId === userId
														? "bg-accent text-white rounded-br-sm"
														: "bg-depth-2 text-text-primary rounded-bl-sm"
												}`}
											>
												<p className="text-sm">{message.content}</p>
											</div>
											<div className="flex items-center gap-1 mt-1">
												<span className="text-xs text-text-tertiary">
													{message.userName}
												</span>
												<span className="text-xs text-text-tertiary">
													{formatTime(message.timestamp)}
												</span>
											</div>
										</div>
									</div>
								)}
							</div>
						))}
						<div ref={messagesEndRef} />
					</>
				)}
			</div>

			{/* Input Area */}
			<div className="p-3 border-t border-border-subtle bg-depth-2">
				{!isConnected ? (
					<div className="text-center text-sm text-text-tertiary py-2">
						Connecting to chat...
					</div>
				) : !userId ? (
					<div className="text-center text-sm text-text-tertiary py-2">
						Sign in to chat
					</div>
				) : (
					<form onSubmit={sendMessage} className="flex gap-2">
						<input
							type="text"
							value={inputMessage}
							onChange={(e) => setInputMessage(e.target.value)}
							placeholder="Type a message..."
							className="flex-1 px-3 py-2 bg-depth-1 border border-border-subtle rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent text-sm"
							maxLength={500}
						/>
						<button
							type="submit"
							disabled={!inputMessage.trim()}
							className="px-3 py-2 bg-accent hover:bg-accent-hover disabled:bg-depth-3 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
						>
							<Send className="w-4 h-4" />
						</button>
					</form>
				)}
			</div>
		</div>
	);
}
