import { useNavigate } from "@tanstack/react-router";
import { Loader2, Plus } from "lucide-react";
import { useEffect, useId, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { useWebSocket } from "#/lib/websocket-context";

interface CreateRoomModalProps {
	children?: React.ReactNode;
}

export function CreateRoomModal({ children }: CreateRoomModalProps) {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [isCreating, setIsCreating] = useState(false);
	const navigate = useNavigate();
	const { socket, setCurrentRoomId } = useWebSocket();
	const nameId = useId();
	const descriptionId = useId();

	// Listen for room creation response
	useEffect(() => {
		if (!socket) return;

		const handleRoomCreated = (data: {
			room: {
				id: string;
				name: string;
				description?: string;
				status: string;
				streamerId: string | null;
				createdAt: Date;
			};
			participant: {
				userId: string;
				userName: string;
				joinedAt: Date;
				isStreamer: boolean;
			};
		}) => {
			console.log("[CreateRoomModal] Room created:", data.room.name);
			setIsCreating(false);
			setOpen(false);
			setName("");
			setDescription("");
			setError(null);

			// Track current room for auto-rejoin
			setCurrentRoomId(data.room.id);

			// Navigate to the new room
			void navigate({
				to: "/room/$roomId",
				params: { roomId: data.room.id },
			});
		};

		const handleRoomCreateError = (data: { message: string }) => {
			console.error("[CreateRoomModal] Room creation failed:", data.message);
			setIsCreating(false);
			setError(data.message);
		};

		socket.on("room:created", handleRoomCreated);
		socket.on("room:create_error", handleRoomCreateError);

		return () => {
			socket.off("room:created", handleRoomCreated);
			socket.off("room:create_error", handleRoomCreateError);
		};
	}, [socket, navigate, setCurrentRoomId]);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();

		if (!socket) {
			setError("Not connected to server");
			return;
		}

		if (name.trim().length < 3) {
			setError("Room name must be at least 3 characters");
			return;
		}
		if (name.trim().length > 100) {
			setError("Room name must be less than 100 characters");
			return;
		}
		if (description.trim().length > 500) {
			setError("Description must be less than 500 characters");
			return;
		}

		setIsCreating(true);
		setError(null);

		console.log("[CreateRoomModal] Emitting room:create", {
			name: name.trim(),
		});

		// Emit WebSocket event to create room
		socket.emit("room:create", {
			name: name.trim(),
			description: description.trim() || undefined,
		});
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				{children || (
					<button
						type="button"
						className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-accent hover:bg-accent-hover text-bg-primary font-bold transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-accent/20"
					>
						<Plus className="h-5 w-5" />
						<span>Create Room</span>
					</button>
				)}
			</DialogTrigger>
			<DialogContent className="bg-depth-1 border-border-subtle text-text-primary sm:max-w-[425px]">
				<DialogHeader>
					<DialogTitle className="text-text-primary">
						Create New Room
					</DialogTitle>
					<DialogDescription className="text-text-secondary">
						Start a new streaming session. You will be the streamer.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="space-y-4 py-4">
					<div className="space-y-2">
						<label
							htmlFor={nameId}
							className="text-sm font-medium text-text-primary"
						>
							Room Name
						</label>
						<Input
							id={nameId}
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Enter room name..."
							className="bg-depth-2 border-border-subtle text-text-primary placeholder:text-text-tertiary"
							maxLength={100}
						/>
						<p className="text-xs text-text-tertiary">
							{name.length}/100 characters
						</p>
					</div>
					<div className="space-y-2">
						<label
							htmlFor={descriptionId}
							className="text-sm font-medium text-text-primary"
						>
							Description (Optional)
						</label>
						<textarea
							id={descriptionId}
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="What's this room about?"
							className="w-full min-h-[100px] px-3 py-2 rounded-md bg-depth-2 border border-border-subtle text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-depth-1"
							maxLength={500}
						/>
						<p className="text-xs text-text-tertiary">
							{description.length}/500 characters
						</p>
					</div>
					{error && <p className="text-sm text-danger">{error}</p>}
					<DialogFooter>
						<button
							type="button"
							onClick={() => setOpen(false)}
							className="px-4 py-2 rounded-lg bg-depth-2 text-text-secondary hover:bg-depth-3 transition-colors"
							disabled={isCreating}
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={isCreating || !name.trim() || !socket}
							className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-bg-primary font-bold transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
						>
							{isCreating ? (
								<>
									<Loader2 className="h-4 w-4 animate-spin" />
									<span>Creating...</span>
								</>
							) : (
								<span>Create Room</span>
							)}
						</button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
