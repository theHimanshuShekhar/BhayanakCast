/**
 * Audio Configuration Modal
 *
 * Shown before starting screen sharing to let user choose audio options
 */

import { Monitor, Volume2, VolumeX } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import type { AudioConfig, ScreenShareOptions } from "#/types/webrtc";

interface AudioConfigModalProps {
	isOpen: boolean;
	onClose: () => void;
	onStart: (options: ScreenShareOptions) => void;
}

export function AudioConfigModal({
	isOpen,
	onClose,
	onStart,
}: AudioConfigModalProps) {
	const [audioConfig, setAudioConfig] = useState<AudioConfig>("system-and-mic");
	const [cursor, setCursor] = useState<"always" | "motion" | "never">("always");

	const handleStart = () => {
		onStart({
			audioConfig,
			cursor,
			displaySurface: "default",
		});
	};

	const audioOptions: {
		value: AudioConfig;
		label: string;
		description: string;
		icon: React.ReactNode;
	}[] = [
		{
			value: "system-and-mic",
			label: "System audio + Microphone",
			description: "Share your computer audio and voice",
			icon: <Volume2 className="h-5 w-5" />,
		},
		{
			value: "system-only",
			label: "System audio only",
			description: "Share your computer audio without microphone",
			icon: <Volume2 className="h-5 w-5" />,
		},
		{
			value: "no-audio",
			label: "No audio",
			description: "Silent stream",
			icon: <VolumeX className="h-5 w-5" />,
		},
	];

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="bg-depth-1 border-border-subtle max-w-md">
				<DialogHeader>
					<DialogTitle className="text-text-primary flex items-center gap-2">
						<Monitor className="h-5 w-5 text-accent" />
						Start Screen Sharing
					</DialogTitle>
					<DialogDescription className="text-text-secondary">
						Choose what to share and your audio preferences
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-6 py-4">
					{/* Audio Configuration */}
					<div className="space-y-3">
						<h3 className="text-text-primary text-sm font-medium">Audio</h3>
						<div className="space-y-2">
							{audioOptions.map((option) => (
								<button
									key={option.value}
									type="button"
									onClick={() => setAudioConfig(option.value)}
									className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-all ${
										audioConfig === option.value
											? "border-accent bg-accent/10"
											: "border-border-subtle hover:border-border-default hover:bg-depth-2"
									}`}
								>
									<div
										className={`mt-0.5 ${
											audioConfig === option.value
												? "text-accent"
												: "text-text-tertiary"
										}`}
									>
										{option.icon}
									</div>
									<div className="flex-1">
										<div
											className={`font-medium ${
												audioConfig === option.value
													? "text-text-primary"
													: "text-text-secondary"
											}`}
										>
											{option.label}
										</div>
										<div className="text-xs text-text-tertiary">
											{option.description}
										</div>
									</div>
									<div
										className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
											audioConfig === option.value
												? "border-accent"
												: "border-border-subtle"
										}`}
									>
										{audioConfig === option.value && (
											<div className="w-2 h-2 rounded-full bg-accent" />
										)}
									</div>
								</button>
							))}
						</div>
					</div>

					{/* Cursor Options */}
					<div className="space-y-3">
						<h3 className="text-text-primary text-sm font-medium">
							Show Cursor
						</h3>
						<div className="flex gap-2">
							{(["always", "motion", "never"] as const).map((option) => (
								<button
									key={option}
									type="button"
									onClick={() => setCursor(option)}
									className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-all ${
										cursor === option
											? "border-accent bg-accent/10 text-text-primary"
											: "border-border-subtle text-text-secondary hover:border-border-default hover:bg-depth-2"
									}`}
								>
									{option.charAt(0).toUpperCase() + option.slice(1)}
								</button>
							))}
						</div>
					</div>
				</div>

				<DialogFooter className="gap-2">
					<Button variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button
						onClick={handleStart}
						className="bg-accent hover:bg-accent-hover text-bg-primary"
					>
						<Monitor className="h-4 w-4 mr-2" />
						Share Screen
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
