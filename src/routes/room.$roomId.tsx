import { useQuery } from "@tanstack/react-query";
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
	Monitor,
	Users,
	Video,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Chat } from "#/components/Chat";
import { StreamerControls } from "#/components/StreamerControls";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { useWebRTC } from "#/hooks/useWebRTC";
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

// Video display component for viewers
interface VideoDisplayProps {
	stream: MediaStream | null;
	streamerName?: string | null;
}

function VideoDisplay({ stream, streamerName }: VideoDisplayProps) {
	const videoRef = useRef<HTMLVideoElement>(null);

	useEffect(() => {
		if (videoRef.current && stream) {
			videoRef.current.srcObject = stream;
		}
	}, [stream]);

	if (!stream) {
		return (
			<div className="bg-depth-2 rounded-xl aspect-video flex flex-col items-center justify-center border-2 border-dashed border-border-subtle">
				<Video className="h-16 w-16 text-text-tertiary mb-4" />
				<p className="text-text-secondary text-lg mb-2">Waiting for Stream</p>
				<p className="text-text-tertiary text-sm">
					{streamerName
						? `${streamerName} will start streaming soon`
						: "No streamer yet"}
				</p>
			</div>
		);
	}

	return (
		<div className="relative rounded-xl overflow-hidden bg-black aspect-video">
			{/* biome-ignore lint/a11y/useMediaCaption: Screen sharing doesn't support captions */}
			<video
				ref={videoRef}
				autoPlay
				playsInline
				className="w-full h-full object-contain"
			/>
			<div className="absolute top-4 left-4 px-3 py-1 rounded bg-black/70 text-white text-sm flex items-center gap-2">
				<Monitor className="h-4 w-4" />
				{streamerName ? `${streamerName}'s Screen` : "Screen Share"}
			</div>
		</div>
	);
}

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

// Transfer overlay component
interface TransferOverlayProps {
	transferState: string;
	transferInfo: { newStreamerName?: string } | null;
}

function TransferOverlay({
	transferState,
	transferInfo,
}: TransferOverlayProps) {
	if (transferState === "idle" || transferState === "connected") return null;

	const messages: Record<string, string> = {
		initiating: "Streamer is leaving...",
		cleaning_up: "Disconnecting...",
		waiting_for_streamer: `Waiting for ${transferInfo?.newStreamerName || "new streamer"}...`,
		reconnecting: "Reconnecting to new streamer...",
		failed: "Connection failed. Retrying...",
	};

	return (
		<div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-50 backdrop-blur-sm">
			<div className="w-12 h-12 border-3 border-white/10 border-t-accent rounded-full animate-spin mb-4" />
			<p className="text-white text-lg font-medium">
				{messages[transferState] || "Connecting..."}
			</p>
			{transferState === "reconnecting" && (
				<p className="text-white/60 text-sm mt-2">
					Setting up peer-to-peer connection
				</p>
			)}
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

	// Query for real-time room data
	const { data: roomData, refetch } = useQuery({
		queryKey: ["room", roomId],
		queryFn: () => getRoomDetails({ data: { roomId } }),
		initialData,
		refetchInterval: 5000, // Refresh every 5 seconds as fallback
	});

	const room = roomData?.room.room;
	const streamer = roomData?.room.streamer;
	const participants = roomData?.participants || [];
	const isActive = room?.status === "active";
	const isPreparing = room?.status === "preparing";

	// WebRTC hook for streaming
	const {
		localStream,
		remoteStream,
		transferState,
		transferInfo,
		isStreamer: isStreamingLocally,
	} = useWebRTC({
		roomId,
		userId: userId || "",
	});

	// WebSocket for real-time updates
	const { socket, isConnected } = useWebSocket();

	// Track if user has joined the room via WebSocket
	const hasJoinedRef = useRef(false);

	// Join room via WebSocket
	const handleJoinRoom = useCallback(() => {
		if (!userId || !isActive || !socket || !isConnected) {
			console.log("[Room] Cannot join - missing requirements");
			return;
		}
		console.log("[Room] Emitting room:join via WebSocket");
		socket.emit("room:join", { roomId });
	}, [userId, isActive, socket, isConnected, roomId]);

	// Leave room via WebSocket
	const handleLeaveRoom = useCallback(() => {
		if (!userId || !socket || !isConnected) {
			console.log("[Room] Cannot leave - missing requirements");
			return;
		}
		console.log("[Room] Emitting room:leave via WebSocket");
		socket.emit("room:leave", { roomId });
		hasJoinedRef.current = false;
		// Redirect to home page after leaving
		void navigate({ to: "/" });
	}, [userId, socket, isConnected, roomId, navigate]);

	// Simple back navigation for ended rooms (no WebSocket required)
	const handleBackToRooms = useCallback(() => {
		void navigate({ to: "/" });
	}, [navigate]);

	// Auto-join room on mount - fires when user loads room page
	useEffect(() => {
		if (userId && !hasJoinedRef.current && socket && isConnected) {
			hasJoinedRef.current = true;
			console.log("[Room] Auto-joining room via WebSocket on page load");
			socket.emit("room:join", { roomId });
		}
	}, [userId, socket, isConnected, roomId]);

	// Reset hasJoinedRef when roomId changes (user navigates to different room)
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional - reset when room changes
	useEffect(() => {
		hasJoinedRef.current = false;
	}, [roomId]);

	// Leave room when component unmounts (user leaves the page)
	useEffect(() => {
		return () => {
			if (hasJoinedRef.current && socket && isConnected) {
				console.log("[Room] Component unmounting - leaving room");
				socket.emit("room:leave", { roomId });
				hasJoinedRef.current = false;
			}
		};
	}, [socket, isConnected, roomId]);

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
	const endTime = room?.endedAt ? new Date(room.endedAt) : now;
	const totalDuration = isActive
		? Math.floor((now.getTime() - startTime.getTime()) / 1000)
		: Math.floor((endTime.getTime() - startTime.getTime()) / 1000);

	// Check if current user is a participant and if they're the streamer
	const isParticipant = participants.some((p) => p.user.id === userId);
	const isStreamer = streamer?.id === userId;

	// Listen for WebSocket events
	useEffect(() => {
		if (!socket || !isConnected) return;

		console.log("[Room] Setting up WebSocket listeners for room:", roomId);

		// User joined the room
		const handleUserJoined = (data: {
			userId: string;
			userName: string;
			participantCount: number;
		}) => {
			console.log("[Room] User joined:", data);
			refetch();
		};

		// User left the room
		const handleUserLeft = (data: {
			userId: string;
			userName: string;
			participantCount: number;
		}) => {
			console.log("[Room] User left:", data);
			refetch();
		};

		// Streamer changed
		const handleStreamerChanged = (data: {
			newStreamerId: string;
			newStreamerName: string;
		}) => {
			console.log("[Room] Streamer changed:", data);
			refetch();
		};

		// Room status changed
		const handleStatusChanged = (data: { status: string }) => {
			console.log("[Room] Status changed:", data);
			refetch();
		};

		// Room joined confirmation
		const handleRoomJoined = (data: {
			roomId: string;
			participantCount: number;
			participants: unknown[];
			isStreamer: boolean;
			becameStreamer: boolean;
			status: string;
			alreadyInRoom?: boolean;
		}) => {
			console.log("[Room] Joined room:", data);
			refetch();
		};

		// Room left confirmation
		const handleRoomLeft = (data: {
			roomId: string;
			participantCount: number;
		}) => {
			console.log("[Room] Left room:", data);
			hasJoinedRef.current = false;
		};

		// Error
		const handleRoomError = (data: { message: string }) => {
			console.error("[Room] Error:", data.message);
			alert(data.message);
		};

		socket.on("room:user_joined", handleUserJoined);
		socket.on("room:user_left", handleUserLeft);
		socket.on("room:streamer_changed", handleStreamerChanged);
		socket.on("room:status_changed", handleStatusChanged);
		socket.on("room:joined", handleRoomJoined);
		socket.on("room:left", handleRoomLeft);
		socket.on("room:error", handleRoomError);

		return () => {
			console.log("[Room] Cleaning up WebSocket listeners");
			socket.off("room:user_joined", handleUserJoined);
			socket.off("room:user_left", handleUserLeft);
			socket.off("room:streamer_changed", handleStreamerChanged);
			socket.off("room:status_changed", handleStatusChanged);
			socket.off("room:joined", handleRoomJoined);
			socket.off("room:left", handleRoomLeft);
			socket.off("room:error", handleRoomError);
		};
	}, [socket, isConnected, refetch, roomId]);

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
												participants.filter((p) => p.user.id !== streamer?.id)
													.length
											}{" "}
											viewers
										</span>
									</div>
								</div>
							</div>

							{/* Video Player with Transfer Overlay */}
							<div className="relative">
								{(() => {
									console.log("[Room] Video render check:", {
										isStreamer,
										isStreamingLocally,
										hasLocalStream: !!localStream,
										hasRemoteStream: !!remoteStream,
									});
									return null;
								})()}
								{isStreamer || isStreamingLocally ? (
									<ScreenSharePreview stream={localStream} />
								) : (
									<VideoDisplay
										stream={remoteStream}
										streamerName={streamer?.name}
									/>
								)}
								<TransferOverlay
									transferState={transferState}
									transferInfo={transferInfo}
								/>
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
											participants.filter((p) => p.user.id !== streamer?.id)
												.length
										}
										)
									</span>
								</h3>
								<div className="space-y-1 max-h-32 overflow-y-auto">
									{participants.filter((p) => p.user.id !== streamer?.id)
										.length === 0 ? (
										<p className="text-xs text-text-tertiary italic">
											No viewers yet
										</p>
									) : (
										participants
											.filter((p) => p.user.id !== streamer?.id)
											.slice(0, 5)
											.map((p) => (
												<Link
													key={p.participant.id}
													to="/profile/$userId"
													params={{ userId: p.user.id }}
													className="flex items-center gap-2 p-1.5 rounded hover:bg-depth-2 transition-colors"
												>
													{p.user.image ? (
														<img
															src={p.user.image}
															alt={p.user.name}
															className="h-6 w-6 rounded-full object-cover"
														/>
													) : (
														<div className="h-6 w-6 rounded-full bg-surface-3 flex items-center justify-center">
															<span className="text-xs font-medium text-text-primary">
																{p.user.name.charAt(0).toUpperCase()}
															</span>
														</div>
													)}
													<span className="text-sm text-text-secondary truncate">
														{p.user.name}
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
									.filter((p) => p.user.id !== userId)
									.map((p) => (
										<button
											key={p.participant.id}
											type="button"
											onClick={() => handleTransferStreamer(p.user.id)}
											className="w-full flex items-center gap-3 p-3 bg-depth-2 hover:bg-depth-3 rounded-lg transition-colors text-left"
										>
											{p.user.image ? (
												<img
													src={p.user.image}
													alt={p.user.name}
													className="h-10 w-10 rounded-full object-cover"
												/>
											) : (
												<div className="h-10 w-10 rounded-full bg-surface-3 flex items-center justify-center">
													<span className="text-sm font-medium text-text-primary">
														{p.user.name.charAt(0).toUpperCase()}
													</span>
												</div>
											)}
											<span className="flex-1 font-medium text-text-primary">
												{p.user.name}
											</span>
										</button>
									))}
							</div>

							{participants.filter((p) => p.user.id !== userId).length ===
								0 && (
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
											participants.filter((p) => p.user.id !== streamer?.id)
												.length
										}
									</span>
								</div>
								{room?.endedAt && (
									<div className="flex items-center gap-1.5">
										<span>
											Ended: <ClientDate date={room.endedAt} />
										</span>
									</div>
								)}
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
										(b.participant.totalTimeSeconds || 0) -
										(a.participant.totalTimeSeconds || 0),
								)
								.map((p, index) => (
									<Link
										key={p.participant.id}
										to="/profile/$userId"
										params={{ userId: p.user.id }}
										className="flex items-center gap-4 p-3 bg-depth-2 rounded-lg hover:bg-depth-3 transition-colors"
									>
										<div className="shrink-0 w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
											<span className="text-sm font-bold text-accent">
												#{index + 1}
											</span>
										</div>

										{p.user.image ? (
											<img
												src={p.user.image}
												alt={p.user.name}
												className="h-12 w-12 rounded-full object-cover"
											/>
										) : (
											<div className="h-12 w-12 rounded-full bg-surface-3 flex items-center justify-center">
												<span className="text-lg font-medium text-text-primary">
													{p.user.name.charAt(0).toUpperCase()}
												</span>
											</div>
										)}

										<div className="flex-1 min-w-0">
											<h3 className="text-base font-medium text-text-primary truncate">
												{p.user.name}
											</h3>
											<p className="text-sm text-text-tertiary">
												Joined <ClientDate date={p.participant.joinedAt} />
											</p>
										</div>

										{p.participant.totalTimeSeconds !== null &&
											p.participant.totalTimeSeconds > 0 && (
												<div className="text-right shrink-0">
													<p className="text-base font-semibold text-accent">
														{formatDuration(p.participant.totalTimeSeconds)}
													</p>
													<p className="text-xs text-text-tertiary">
														watch time
													</p>
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
