import { useMutation, useQuery } from "@tanstack/react-query";
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
	Loader2,
	Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { authClient } from "#/lib/auth-client";
import { getRoomDetails } from "#/utils/room-details";
import { joinRoom, leaveRoom, transferStreamerOwnership } from "#/utils/rooms";

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
});

function RoomDetailPage() {
	const navigate = useNavigate();
	const { roomId } = Route.useParams();
	const initialData = Route.useLoaderData();
	const { data: session } = authClient.useSession();
	const userId = session?.user?.id;

	// Query for real-time room data
	const { data: roomData, refetch } = useQuery({
		queryKey: ["room", roomId],
		queryFn: () => getRoomDetails({ data: { roomId } }),
		initialData,
		refetchInterval: 5000, // Refresh every 5 seconds
	});

	const room = roomData?.room.room;
	const streamer = roomData?.room.streamer;
	const participants = roomData?.participants || [];
	const isActive = room?.status === "active";

	// Join room on mount (if active and user is logged in)
	const joinMutation = useMutation({
		mutationFn: () => {
			if (!userId || !isActive) throw new Error("Cannot join room");
			return joinRoom({ data: { roomId, userId } });
		},
		onSuccess: () => {
			refetch();
		},
	});

	// Leave room
	const leaveMutation = useMutation({
		mutationFn: () => {
			if (!userId) throw new Error("Not logged in");
			return leaveRoom({ data: { roomId, userId } });
		},
		onSuccess: () => {
			refetch();
			// Redirect to home page after leaving
			void navigate({ to: "/" });
		},
		onError: (error) => {
			console.error("Failed to leave room:", error);
			alert(`Failed to leave room: ${error.message}`);
		},
	});

	// Auto-join room on mount (only once)
	const hasAutoJoined = useRef(false);
	useEffect(() => {
		if (userId && isActive && !hasAutoJoined.current) {
			hasAutoJoined.current = true;
			joinMutation.mutate();
		}
	}, [userId, isActive, joinMutation]);

	// Calculate duration - use client-only time to avoid hydration mismatch
	const [clientNow, setClientNow] = useState<Date | null>(null);

	useEffect(() => {
		setClientNow(new Date());
		// Update every second for live duration
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

	// Transfer dialog state
	const [showTransferDialog, setShowTransferDialog] = useState(false);

	// Streamer leave confirmation dialog state
	const [showStreamerLeaveDialog, setShowStreamerLeaveDialog] = useState(false);

	// Transfer ownership mutation
	const transferMutation = useMutation({
		mutationFn: (newStreamerId: string) => {
			if (!userId) throw new Error("Not logged in");
			return transferStreamerOwnership({
				data: {
					roomId,
					newStreamerId,
					currentStreamerId: userId,
				},
			});
		},
		onSuccess: () => {
			refetch();
			setShowTransferDialog(false);
		},
	});

	return (
		<div className="h-full w-full bg-depth-0 px-4 py-8 overflow-auto">
			<div className="mx-auto max-w-4xl space-y-6">
				{/* Back button */}
				<Link
					to="/"
					className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors"
				>
					<ArrowLeft className="h-4 w-4" />
					<span>Back to rooms</span>
				</Link>

				{/* Room Header */}
				<div className="bg-depth-1 rounded-lg p-6 border border-border-subtle">
					<div className="flex items-start gap-4">
						<div className="flex-1">
							<div className="flex items-center gap-3 mb-2">
								<h1 className="text-2xl font-bold text-text-primary">
									{room?.name}
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
									<span className="px-2 py-1 rounded text-xs font-medium bg-gray-500/20 text-gray-400">
										Ended
									</span>
								)}
							</div>
							<p className="text-text-secondary mb-4">{room?.description}</p>

							<div className="flex flex-wrap gap-4 text-sm text-text-tertiary">
								<div className="flex items-center gap-1.5">
									<Clock className="h-4 w-4" />
									<span>
										{isActive ? "Duration: " : "Duration: "}
										{formatDuration(totalDuration)}
									</span>
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
								{!isActive && room?.endedAt && (
									<div className="flex items-center gap-1.5">
										<span>
											Ended: <ClientDate date={room.endedAt} />
										</span>
									</div>
								)}
							</div>
						</div>

						{/* Join/Leave and Streamer Controls */}
						{userId && isActive && (
							<div className="flex items-center gap-3">
								{/* Streamer Controls - Transfer Only */}
								{isStreamer && (
									<button
										type="button"
										onClick={() => setShowTransferDialog(true)}
										className="flex items-center gap-2 px-4 py-2 rounded-lg bg-depth-2 hover:bg-depth-3 text-text-secondary transition-colors"
									>
										<ArrowLeftRight className="h-4 w-4" />
										<span>Transfer Streamer</span>
									</button>
								)}

								{/* Join/Leave Button */}
								{isParticipant ? (
									<button
										type="button"
										onClick={() => {
											if (isStreamer) {
												setShowStreamerLeaveDialog(true);
											} else {
												leaveMutation.mutate();
											}
										}}
										disabled={leaveMutation.isPending}
										className="flex items-center gap-2 px-4 py-2 rounded-lg bg-depth-2 hover:bg-depth-3 text-text-secondary transition-colors"
									>
										{leaveMutation.isPending ? (
											<Loader2 className="h-4 w-4 animate-spin" />
										) : (
											<>
												<DoorOpen className="h-4 w-4" />
												<span>Leave</span>
											</>
										)}
									</button>
								) : (
									<button
										type="button"
										onClick={() => joinMutation.mutate()}
										disabled={joinMutation.isPending}
										className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-bg-primary font-bold transition-colors"
									>
										{joinMutation.isPending ? (
											<Loader2 className="h-4 w-4 animate-spin" />
										) : (
											<span>Join Room</span>
										)}
									</button>
								)}
							</div>
						)}
					</div>
				</div>

				{/* Streamer Section */}
				<div className="bg-depth-1 rounded-lg p-6 border border-border-subtle">
					<h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
						<Crown className="h-5 w-5 text-yellow-500" />
						Streamer
					</h2>
					<div className="flex items-center gap-4">
						{streamer ? (
							<>
								{streamer.image ? (
									<img
										src={streamer.image}
										alt={streamer.name}
										className="h-16 w-16 rounded-full object-cover"
									/>
								) : (
									<div className="h-16 w-16 rounded-full bg-accent flex items-center justify-center">
										<span className="text-xl font-bold text-white">
											{streamer.name.charAt(0).toUpperCase()}
										</span>
									</div>
								)}
								<div>
									<h3 className="text-lg font-medium text-text-primary">
										{streamer.name}
									</h3>
									<p className="text-sm text-text-tertiary">Host</p>
								</div>
								<Link
									to="/profile/$userId"
									params={{ userId: streamer.id }}
									className="ml-auto px-4 py-2 bg-depth-2 hover:bg-depth-3 rounded-lg text-sm font-medium transition-colors"
								>
									View Profile
								</Link>
							</>
						) : (
							<>
								<div className="h-16 w-16 rounded-full bg-depth-3 flex items-center justify-center">
									<span className="text-xl font-bold text-text-secondary">
										?
									</span>
								</div>
								<div>
									<h3 className="text-lg font-medium text-text-secondary">
										No Streamer
									</h3>
									<p className="text-sm text-text-tertiary">Waiting for host</p>
								</div>
							</>
						)}
					</div>
				</div>

				{/* Viewers List - Filter out streamer */}
				{(() => {
					const viewers = participants.filter(
						(p) => p.user.id !== streamer?.id,
					);
					return (
						<div className="bg-depth-1 rounded-lg p-6 border border-border-subtle">
							<h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
								<Users className="h-5 w-5 text-accent" />
								Viewers
								<span className="text-sm font-normal text-text-tertiary ml-2">
									({viewers.length})
								</span>
							</h2>

							{viewers.length === 0 ? (
								<p className="text-text-secondary">
									{isActive
										? "No viewers yet. Be the first to join!"
										: "No viewers participated in this stream."}
								</p>
							) : (
								<div className="space-y-3">
									{viewers.map((p, index) => (
										<div
											key={p.participant.id}
											className="flex items-center gap-4 p-3 bg-depth-2 rounded-lg"
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
										</div>
									))}
								</div>
							)}
						</div>
					);
				})()}

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
											onClick={() => transferMutation.mutate(p.user.id)}
											disabled={transferMutation.isPending}
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
									leaveMutation.mutate();
									setShowStreamerLeaveDialog(false);
								}}
								disabled={leaveMutation.isPending}
								className="flex-1 px-4 py-2 bg-warning hover:bg-warning/90 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
							>
								{leaveMutation.isPending ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : (
									<>
										<DoorOpen className="h-4 w-4" />
										<span>Leave Room</span>
									</>
								)}
							</button>
						</div>
					</DialogContent>
				</Dialog>
			</div>
		</div>
	);
}
