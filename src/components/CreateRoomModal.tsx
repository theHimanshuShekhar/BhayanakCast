import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Loader2, Plus } from "lucide-react";
import { useId, useState } from "react";
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
import { createRoom } from "#/utils/rooms";

interface CreateRoomModalProps {
	userId: string;
	children?: React.ReactNode;
}

export function CreateRoomModal({ userId, children }: CreateRoomModalProps) {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [error, setError] = useState<string | null>(null);
	const navigate = useNavigate();
	const nameId = useId();
	const descriptionId = useId();

	const createRoomMutation = useMutation({
		mutationFn: async () => {
			return createRoom({
				data: {
					name: name.trim(),
					description: description.trim() || undefined,
					userId,
				},
			});
		},
		onSuccess: (data) => {
			setOpen(false);
			setName("");
			setDescription("");
			setError(null);
			// Navigate to the new room
			void navigate({ to: "/room/$roomId", params: { roomId: data.room.id } });
		},
		onError: (err: Error) => {
			setError(err.message || "Failed to create room");
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
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
		createRoomMutation.mutate();
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
							disabled={createRoomMutation.isPending}
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={createRoomMutation.isPending || !name.trim()}
							className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-bg-primary font-bold transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
						>
							{createRoomMutation.isPending ? (
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
