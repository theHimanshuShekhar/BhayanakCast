import {
	createFileRoute,
	Link,
	notFound,
	useNavigate,
} from "@tanstack/react-router";
import {
	ArrowLeft,
	ArrowLeftRight,
	Clock,
	Crown,
	DoorOpen,
	Users,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Chat } from "#/components/Chat";
import { StreamerControls } from "#/components/StreamerControls";
import { StreamingErrorBoundary } from "#/components/StreamingErrorBoundary";
import { TransferOverlay } from "#/components/TransferOverlay";
import { VideoDisplay } from "#/components/VideoDisplay";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { usePeerJS } from "#/hooks/usePeerJS";
import { useRoom } from "#/hooks/useRoom";
import { authClient } from "#/lib/auth-client";
import { detectDevice } from "#/lib/device-detection";
import { censorText } from "#/lib/profanity-filter";
import {
	OG_IMAGE_URL,
	SITE_DESCRIPTION,
	SITE_TITLE,
	SITE_URL,
} from "#/lib/site";
import { useWebSocket } from "#/lib/websocket-context";
import { getRoomDetails } from "#/utils/room-details";

function formatDuration(seconds: number): string {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

function formatDate(date: Date): string {
	return new Date(date).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

// Client-only date component to avoid hydration mismatch
function ClientDate({ date }: { date: Date }) {
	const [formatted, setFormatted] = useState<string>("");

	useEffect(() => {
		setFormatted(formatDate(date));
	}, [date]);

	return <span>{formatted || "..."}</span>;
}

export const Route = createFileRoute("/room/$roomId")({
	component: RoomDetailPage,
	loader: async ({ params }) => {
		try {
			const data = await getRoomDetails({ data: { roomId: params.roomId } });
			return data;
		} catch {
			throw notFound();
		}
	},
	head: ({ loaderData }) => {
		const room = loaderData?.room.room;
		const streamer = loaderData?.room.streamer;
		const roomUrl = `${SITE_URL}/room/${room?.id}`;
		const title = room?.name
			? `${censorText(room.name)} | ${SITE_TITLE}`
			: SITE_TITLE;
		const description =
			(room?.description ? censorText(room.description) : null) ||
			SITE_DESCRIPTION;
		const image = streamer?.image || OG_IMAGE_URL;

		return {
			meta: [
				{ title },
				{ name: "description", content: description },
				// Open Graph
				{ property: "og:title", content: title },
				{ property: "og:description", content: description },
				{ property: "og:image", content: image },
				{ property: "og:url", content: roomUrl },
				{ property: "og:type", content: "website" },
				// Twitter Card
				{ name: "twitter:title", content: title },
				{ name: "twitter:description", content: description },
				{ name: "twitter:image", content: image },
				{ name: "twitter:url", content: roomUrl },
				{ name: "twitter:card", content: "summary_large_image" },
			],
		};
	},
});


// Screen share preview component for streamers
interface ScreenSharePreviewProps {
	stream: MediaStream | null;
}

function ScreenSharePreview({ stream }: ScreenSharePreviewProps) {
	const videoRef = useRef<HTMLVideoElement>(null);

	useEffect(() => {
		if (videoRef.current && stream) {
			console.log(
				"[ScreenSharePreview] Setting stream:",
				stream.id,
				"Tracks:",
				stream.getTracks().length,
			);
			videoRef.current.srcObject = stream;
			videoRef.current.play().catch((err) => {
				console.error("[ScreenSharePreview] Error playing video:", err);
			});
		}
	}, [stream]);

	if (!stream) {
		return (
			<div className="bg-depth-2 rounded-xl aspect-video flex flex-col items-center justify-center border-2 border-dashed border-border-subtle">
				<Monitor className="h-16 w-16 text-text-tertiary mb-4" />
				<p className="text-text-secondary text-lg mb-2">Ready to Stream</p>
				<p className="text-text-tertiary text-sm">
					Click "Start Streaming" to begin
				</p>
			</div>
		);
	}

	return (
		<div className="relative rounded-xl overflow-hidden bg-black aspect-video">
			<video
				ref={videoRef}
				autoPlay
				playsInline
				muted
				className="w-full h-full object-contain"
			/>
			<div className="absolute top-4 left-4 px-3 py-1 rounded bg-red-500/90 text-white text-sm flex items-center gap-2">
				<span className="relative flex h-2 w-2">
					<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
					<span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
				</span>
				LIVE - Your Screen
			</div>
		</div>
	);
}


function RoomDetailPage() {
	const navigate = useNavigate();
	const { roomId } = Route.useParams();
	const initialData = Route.useLoaderData();
	const { data: session } = authClient.useSession();
	const userId = session?.user?.id;

	// Device detection - memoized once
	detectDevice();

	// WebSocket-first room state (replaces React Query polling)
	const { roomState, leaveRoom, isJoined } = useRoom(roomId);

	// PeerJS hook for streaming (pass streamerPeerId so late joiners auto-connect)
	const { localStream, remoteStream, connectionStatus } = usePeerJS({
		roomId,
		userId: userId || "",
		streamerPeerId: roomState?.streamerPeerId ?? null,
	});

	// WebSocket for real-time updates and room tracking
	const { socket, isConnected, setCurrentRoomId } = useWebSocket();

	// Track current room for auto-rejoin on reconnect
	useEffect(() => {
		if (roomId) {
			setCurrentRoomId(roomId);
		}
		return () => {
			setCurrentRoomId(null);
		};
	}, [roomId, setCurrentRoomId]);

	// Extract data from roomState (WebSocket) with fallback to initialData (SSR)
	const room = roomState || {
		id: initialData?.room.room?.id || roomId,
		name: initialData?.room.room?.name || "Loading...",
		description: initialData?.room.room?.description || "",
		status:
			(initialData?.room.room?.status as
				| "waiting"
				| "preparing"
				| "active"
				| "ended") || "waiting",
		streamerId: initialData?.room.room?.streamerId || null,
		participants: [],
		createdAt: initialData?.room.room?.createdAt || new Date(),
	};

	const isActive = room.status === "active";
	const isPreparing = room.status === "preparing";

	// Get streamer info from initial data (for SSR) or from roomState
	const streamer = initialData?.room.streamer;

	// Participants from roomState (real-time via WebSocket)
	const participants = room.participants || [];

	// Leave room handler
	const handleLeaveRoom = useCallback(() => {
		if (!userId || !isConnected) {
			console.log("[Room] Cannot leave - missing requirements");
			return;
		}
		console.log("[Room] Leaving room");
		leaveRoom();
		// Redirect to home page after leaving
		void navigate({ to: "/" });
	}, [userId, isConnected, leaveRoom, navigate]);

	// Simple back navigation for ended rooms (no WebSocket required)
	const handleBackToRooms = useCallback(() => {
		void navigate({ to: "/" });
	}, [navigate]);

	// Join room handler (for manual join button)
	const handleJoinRoom = useCallback(() => {
		if (!userId || !isActive || !isConnected) {
			console.log("[Room] Cannot join - missing requirements");
			return;
		}
		console.log("[Room] Joining room");
		// Join is handled automatically by useRoom, but we can trigger it here if needed
	}, [userId, isActive, isConnected]);

	// Refs to track latest values for cleanup
	const socketRef = useRef(socket);
	const isConnectedRef = useRef(isConnected);
	const roomIdRef = useRef(roomId);
	const isJoinedRef = useRef(isJoined);

	// Update refs when values change
	useEffect(() => {
		socketRef.current = socket;
		isConnectedRef.current = isConnected;
		roomIdRef.current = roomId;
		isJoinedRef.current = isJoined;
	}, [socket, isConnected, roomId, isJoined]);

	// Leave room when component unmounts (user leaves the page)
	useEffect(() => {
		return () => {
			// Only leave if we actually joined the room
			if (socketRef.current && isConnectedRef.current && isJoinedRef.current) {
				console.log("[Room] Component unmounting - leaving room");
				socketRef.current.emit("room:leave", { roomId: roomIdRef.current });
			}
		};
	}, []); // Empty deps - only run cleanup on unmount

	// Send device info on identify
	useEffect(() => {
		if (socket && isConnected && userId) {
			const device = detectDevice();
			socket.emit("identify", {
				userId,
				userName: session?.user?.name,
				userImage: session?.user?.image,
				isMobile: device.isMobile,
			});
		}
	}, [socket, isConnected, userId, session?.user?.name, session?.user?.image]);

	// Calculate duration - use client-only time to avoid hydration mismatch
	const [clientNow, setClientNow] = useState<Date | null>(null);

	useEffect(() => {
		setClientNow(new Date());
		const interval = setInterval(() => {
			setClientNow(new Date());
		}, 1000);
		return () => clearInterval(interval);
	}, []);

	const now = clientNow || new Date();
	const startTime = room?.createdAt ? new Date(room.createdAt) : now;
	const totalDuration = Math.floor(
		(now.getTime() - startTime.getTime()) / 1000,
	);

	// Check if current user is a participant and if they're the streamer
	const isParticipant = participants.some((p) => p.userId === userId);
	// Use roomState for real-time streamer check (not stale initialData)
	const isStreamer =
		userId && roomState ? roomState.streamerId === userId : false;

	// Transfer dialog state
	const [showTransferDialog, setShowTransferDialog] = useState(false);

	// Streamer leave confirmation dialog state
	const [showStreamerLeaveDialog, setShowStreamerLeaveDialog] = useState(false);

	// Transfer streamer via WebSocket
	const handleTransferStreamer = useCallback(
		(newStreamerId: string) => {
			if (!socket || !isConnected) return;
			socket.emit("streamer:transfer", { roomId, newStreamerId });
			setShowTransferDialog(false);
		},
		[socket, isConnected, roomId],
	);

	// Active room layout with two columns
	if (isActive || isPreparing) {
		return (
			<div className="h-full w-full bg-depth-0 overflow-hidden">
				{/* Back button - Fixed at top */}
				<div className="px-4 py-3 border-b border-border-subtle bg-depth-1">
					<button
						type="button"
						onClick={handleLeaveRoom}
						className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors"
					>
						<ArrowLeft className="h-4 w-4" />
						<span>Back to rooms</span>
					</button>
				</div>

				{/* Two-column layout */}
				<div className="flex h-[calc(100%-53px)]">
					{/* Column 1: Main Content (70%) */}
					<div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
						<div className="p-6 space-y-6">
							{/* Room Header */}
							<div>
								<div className="flex items-center gap-3 mb-2">
									<h1 className="text-2xl font-bold text-text-primary">
										{censorText(room?.name || "")}
									</h1>
									{isActive ? (
										<span className="px-2 py-1 rounded text-xs font-medium bg-red-500/20 text-red-400 flex items-center gap-1">
											<span className="relative flex h-2 w-2">
												<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
												<span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
											</span>
											LIVE
										</span>
									) : (
										<span className="px-2 py-1 rounded text-xs font-medium bg-yellow-500/20 text-yellow-400">
											Preparing
										</span>
									)}
								</div>
								<p className="text-text-secondary">
									{censorText(room?.description || "")}
								</p>

								{/* Room Stats */}
								<div className="flex flex-wrap gap-4 mt-4 text-sm text-text-tertiary">
									<div className="flex items-center gap-1.5">
										<Clock className="h-4 w-4" />
										<span>{formatDuration(totalDuration)}</span>
									</div>
									<div className="flex items-center gap-1.5">
										<Users className="h-4 w-4" />
										<span>
											{
												participants.filter((p) => p.userId !== streamer?.id)
													.length
											}{" "}
											viewers
										</span>
									</div>
								</div>
							</div>

							{/* Video Player with Transfer Overlay */}
							<div className="relative">
								<StreamingErrorBoundary>
									{/* Show local preview when actively streaming, otherwise show remote stream */}
									{localStream ? (
										<ScreenSharePreview stream={localStream} />
									) : (
										<VideoDisplay
											stream={remoteStream}
											streamerName={streamer?.name}
											connectionStatus={connectionStatus}
										/>
									)}
									<TransferOverlay
										isTransferring={false}
										newStreamerName={streamer?.name ?? undefined}
									/>
								</StreamingErrorBoundary>
							</div>

							{/* Streamer Controls */}
							{userId && isStreamer && (
								<div className="flex items-center gap-3 pt-2">
									<StreamerControls roomId={roomId} userId={userId} />
									<button
										type="button"
										onClick={() => setShowTransferDialog(true)}
										className="flex items-center gap-2 px-4 py-2 rounded-lg bg-depth-2 hover:bg-depth-3 text-text-secondary transition-colors"
									>
										<ArrowLeftRight className="h-4 w-4" />
										<span>Transfer Streamer</span>
									</button>
									<button
										type="button"
										onClick={() => setShowStreamerLeaveDialog(true)}
										className="flex items-center gap-2 px-4 py-2 rounded-lg bg-depth-2 hover:bg-depth-3 text-text-secondary transition-colors"
									>
										<DoorOpen className="h-4 w-4" />
										<span>Leave Room</span>
									</button>
								</div>
							)}

							{/* Viewer Leave Button */}
							{userId && isParticipant && !isStreamer && (
								<div className="flex items-center gap-3 pt-2">
									<button
										type="button"
										onClick={handleLeaveRoom}
										className="flex items-center gap-2 px-4 py-2 rounded-lg bg-depth-2 hover:bg-depth-3 text-text-secondary transition-colors"
									>
										<DoorOpen className="h-4 w-4" />
										<span>Leave Room</span>
									</button>
								</div>
							)}

							{/* Join Button for non-participants */}
							{userId && !isParticipant && isActive && (
								<div className="flex items-center gap-3 pt-2">
									<button
										type="button"
										onClick={handleJoinRoom}
										className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-bg-primary font-bold transition-colors"
									>
										<span>Join Room</span>
									</button>
								</div>
							)}
						</div>
					</div>

					{/* Column 2: Sidebar (30%, min 320px) */}
					<div className="w-80 min-w-80 border-l border-border-subtle bg-depth-1 flex flex-col">
						{/* Streamer & Viewers Section */}
						<div className="p-4 border-b border-border-subtle">
							{/* Current Streamer */}
							<div className="mb-4">
								<h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2 flex items-center gap-1.5">
									<Crown className="h-3 w-3" />
									Streamer
								</h3>
								{streamer ? (
									<Link
										to="/profile/$userId"
										params={{ userId: streamer.id }}
										className="flex items-center gap-3 p-2 rounded-lg bg-depth-2 hover:bg-depth-3 transition-colors"
									>
										{streamer.image ? (
											<img
												src={streamer.image}
												alt={streamer.name}
												className="h-10 w-10 rounded-full object-cover"
											/>
										) : (
											<div className="h-10 w-10 rounded-full bg-accent flex items-center justify-center">
												<span className="text-sm font-bold text-white">
													{streamer.name.charAt(0).toUpperCase()}
												</span>
											</div>
										)}
										<div className="flex-1 min-w-0">
											<p className="text-sm font-medium text-text-primary truncate">
												{streamer.name}
											</p>
											<p className="text-xs text-text-tertiary">Host</p>
										</div>
									</Link>
								) : (
									<div className="flex items-center gap-3 p-2 rounded-lg bg-depth-2">
										<div className="h-10 w-10 rounded-full bg-depth-3 flex items-center justify-center">
											<span className="text-sm font-bold text-text-secondary">
												?
											</span>
										</div>
										<div>
											<p className="text-sm font-medium text-text-secondary">
												No Streamer
											</p>
											<p className="text-xs text-text-tertiary">Waiting</p>
										</div>
									</div>
								)}
							</div>

							{/* Viewers List */}
							<div>
								<h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2 flex items-center gap-1.5">
									<Users className="h-3 w-3" />
									Viewers
									<span className="text-text-tertiary">
										(
										{
											participants.filter((p) => p.userId !== streamer?.id)
												.length
										}
										)
									</span>
								</h3>
								<div className="space-y-1 max-h-32 overflow-y-auto">
									{participants.filter((p) => p.userId !== streamer?.id)
										.length === 0 ? (
										<p className="text-xs text-text-tertiary italic">
											No viewers yet
										</p>
									) : (
										participants
											.filter((p) => p.userId !== streamer?.id)
											.slice(0, 5)
											.map((p) => (
												<Link
													key={p.userId}
													to="/profile/$userId"
													params={{ userId: p.userId }}
													className="flex items-center gap-2 p-1.5 rounded hover:bg-depth-2 transition-colors"
												>
													{p.userImage ? (
														<img
															src={p.userImage}
															alt={p.userName}
															className="h-6 w-6 rounded-full object-cover"
														/>
													) : (
														<div className="h-6 w-6 rounded-full bg-surface-3 flex items-center justify-center">
															<span className="text-xs font-medium text-text-primary">
																{p.userName.charAt(0).toUpperCase()}
															</span>
														</div>
													)}
													<span className="text-sm text-text-secondary truncate">
														{p.userName}
													</span>
												</Link>
											))
									)}
								</div>
							</div>
						</div>

						{/* Chat Section */}
						<Chat
							roomId={roomId}
							userId={userId}
							userName={session?.user?.name}
							userImage={session?.user?.image}
						/>
					</div>
				</div>

				{/* Transfer Ownership Dialog */}
				{showTransferDialog && (
					<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
						<div className="bg-depth-1 rounded-lg p-6 max-w-md w-full border border-border-subtle">
							<h3 className="text-lg font-semibold text-text-primary mb-4">
								Transfer Streamer Ownership
							</h3>
							<p className="text-text-secondary mb-4">
								Select a viewer to transfer streamer ownership to. This action
								has a 30-second cooldown.
							</p>

							<div className="space-y-2 max-h-64 overflow-y-auto mb-4">
								{participants
									.filter((p) => p.userId !== userId)
									.map((p) => (
										<button
											key={p.userId}
											type="button"
											onClick={() => handleTransferStreamer(p.userId)}
											className="w-full flex items-center gap-3 p-3 bg-depth-2 hover:bg-depth-3 rounded-lg transition-colors text-left"
										>
											{p.userImage ? (
												<img
													src={p.userImage}
													alt={p.userName}
													className="h-10 w-10 rounded-full object-cover"
												/>
											) : (
												<div className="h-10 w-10 rounded-full bg-surface-3 flex items-center justify-center">
													<span className="text-sm font-medium text-text-primary">
														{p.userName.charAt(0).toUpperCase()}
													</span>
												</div>
											)}
											<span className="flex-1 font-medium text-text-primary">
												{p.userName}
											</span>
										</button>
									))}
							</div>

							{participants.filter((p) => p.userId !== userId).length === 0 && (
								<p className="text-text-secondary text-center py-4">
									No other viewers to transfer to.
								</p>
							)}

							<div className="flex gap-3">
								<button
									type="button"
									onClick={() => setShowTransferDialog(false)}
									className="flex-1 px-4 py-2 bg-depth-2 hover:bg-depth-3 rounded-lg text-text-secondary transition-colors"
								>
									Cancel
								</button>
							</div>
						</div>
					</div>
				)}

				{/* Streamer Leave Confirmation Dialog */}
				<Dialog
					open={showStreamerLeaveDialog}
					onOpenChange={setShowStreamerLeaveDialog}
				>
					<DialogContent className="bg-depth-1 border-border-subtle">
						<DialogHeader>
							<DialogTitle className="text-text-primary flex items-center gap-2">
								<DoorOpen className="h-5 w-5 text-warning" />
								Leave Room as Streamer
							</DialogTitle>
							<DialogDescription className="text-text-secondary">
								You are the streamer. Leaving will automatically transfer
								ownership to the next viewer. If no viewers remain, the room
								will end.
							</DialogDescription>
						</DialogHeader>
						<div className="flex gap-3 mt-4">
							<button
								type="button"
								onClick={() => setShowStreamerLeaveDialog(false)}
								className="flex-1 px-4 py-2 bg-depth-2 hover:bg-depth-3 rounded-lg text-text-secondary transition-colors"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={() => {
									handleLeaveRoom();
									setShowStreamerLeaveDialog(false);
								}}
								className="flex-1 px-4 py-2 bg-warning hover:bg-warning/90 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
							>
								<DoorOpen className="h-4 w-4" />
								<span>Leave Room</span>
							</button>
						</div>
					</DialogContent>
				</Dialog>
			</div>
		);
	}

	// Ended room layout
	return (
		<div className="h-full w-full bg-depth-0 px-4 py-8 overflow-auto">
			<div className="mx-auto max-w-4xl space-y-6">
				{/* Back button - use simple navigation for ended rooms */}
				<button
					type="button"
					onClick={handleBackToRooms}
					className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors"
				>
					<ArrowLeft className="h-4 w-4" />
					<span>Back to rooms</span>
				</button>

				{/* Room Header */}
				<div className="bg-depth-1 rounded-lg p-6 border border-border-subtle">
					<div className="flex items-start gap-4">
						<div className="flex-1">
							<div className="flex items-center gap-3 mb-2">
								<h1 className="text-2xl font-bold text-text-primary">
									{censorText(room?.name || "")}
								</h1>
								<span className="px-2 py-1 rounded text-xs font-medium bg-gray-500/20 text-gray-400">
									Ended
								</span>
							</div>
							<p className="text-text-secondary mb-4">
								{censorText(room?.description || "")}
							</p>

							<div className="flex flex-wrap gap-4 text-sm text-text-tertiary">
								<div className="flex items-center gap-1.5">
									<Clock className="h-4 w-4" />
									<span>Duration: {formatDuration(totalDuration)}</span>
								</div>
								<div className="flex items-center gap-1.5">
									<Users className="h-4 w-4" />
									<span>
										Viewers:{" "}
										{
											participants.filter((p) => p.userId !== streamer?.id)
												.length
										}
									</span>
								</div>
							</div>
						</div>
					</div>
				</div>

				{/* Participants Section */}
				<div className="bg-depth-1 rounded-lg p-6 border border-border-subtle">
					<h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
						<Users className="h-5 w-5 text-accent" />
						Participants
						<span className="text-sm font-normal text-text-tertiary ml-2">
							({participants.length})
						</span>
					</h2>

					{participants.length === 0 ? (
						<p className="text-text-secondary">
							No participants in this stream.
						</p>
					) : (
						<div className="space-y-3">
							{[...participants]
								.sort(
									(a, b) =>
										(b.totalTimeSeconds || 0) - (a.totalTimeSeconds || 0),
								)
								.map((p, index) => (
									<Link
										key={p.userId}
										to="/profile/$userId"
										params={{ userId: p.userId }}
										className="flex items-center gap-4 p-3 bg-depth-2 rounded-lg hover:bg-depth-3 transition-colors"
									>
										<div className="shrink-0 w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
											<span className="text-sm font-bold text-accent">
												#{index + 1}
											</span>
										</div>

										{p.userImage ? (
											<img
												src={p.userImage}
												alt={p.userName}
												className="h-12 w-12 rounded-full object-cover"
											/>
										) : (
											<div className="h-12 w-12 rounded-full bg-surface-3 flex items-center justify-center">
												<span className="text-lg font-medium text-text-primary">
													{p.userName.charAt(0).toUpperCase()}
												</span>
											</div>
										)}

										<div className="flex-1 min-w-0">
											<h3 className="text-base font-medium text-text-primary truncate">
												{p.userName}
											</h3>
											<p className="text-sm text-text-tertiary">
												Joined <ClientDate date={p.joinedAt} />
											</p>
										</div>

										{p.totalTimeSeconds !== null && p.totalTimeSeconds > 0 && (
											<div className="text-right shrink-0">
												<p className="text-base font-semibold text-accent">
													{formatDuration(p.totalTimeSeconds)}
												</p>
												<p className="text-xs text-text-tertiary">watch time</p>
											</div>
										)}
									</Link>
								))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
