/**
 * Streamer Controls Component
 *
 * Shows streaming controls for desktop users
 * Mobile users see disabled button with explanation
 */

import { Mic, MicOff, Monitor, Smartphone, StopCircle } from "lucide-react";
import { useState } from "react";
import { AudioConfigModal } from "#/components/AudioConfigModal";
import { Button } from "#/components/ui/button";
import { useWebRTC } from "#/hooks/useWebRTC";
import type { ScreenShareOptions } from "#/types/webrtc";

interface StreamerControlsProps {
	roomId: string;
	userId: string;
}

export function StreamerControls({ roomId, userId }: StreamerControlsProps) {
	const [showAudioConfig, setShowAudioConfig] = useState(false);

	const {
		isScreenSharing,
		deviceCapabilities,
		startScreenShare,
		stopScreenShare,
		audioConfig,
		isAudioEnabled,
		toggleAudio,
	} = useWebRTC({ roomId, userId });

	// Handle start streaming with options
	const handleStartStream = (options: ScreenShareOptions) => {
		startScreenShare(options);
		setShowAudioConfig(false);
	};

	// Mobile users see disabled button
	if (deviceCapabilities.isMobile) {
		return (
			<div className="flex items-center gap-2">
				<Button
					disabled
					variant="outline"
					className="opacity-50 cursor-not-allowed"
				>
					<Smartphone className="h-4 w-4 mr-2" />
					Start Streaming
				</Button>
				<span className="text-xs text-text-tertiary">
					Mobile devices cannot stream
				</span>
			</div>
		);
	}

	// Desktop: Not streaming yet
	if (!isScreenSharing) {
		return (
			<>
				<Button
					onClick={() => setShowAudioConfig(true)}
					className="bg-accent hover:bg-accent-hover text-bg-primary font-medium"
				>
					<Monitor className="h-4 w-4 mr-2" />
					Start Streaming
				</Button>

				<AudioConfigModal
					isOpen={showAudioConfig}
					onClose={() => setShowAudioConfig(false)}
					onStart={handleStartStream}
				/>
			</>
		);
	}

	// Desktop: Currently streaming
	return (
		<div className="flex items-center gap-2">
			{/* Audio toggle */}
			<Button
				variant="outline"
				size="icon"
				onClick={toggleAudio}
				title={isAudioEnabled ? "Mute audio" : "Unmute audio"}
				className={
					!isAudioEnabled
						? "bg-red-500/10 text-red-500 border-red-500/30 hover:bg-red-500/20"
						: ""
				}
			>
				{isAudioEnabled ? (
					<Mic className="h-4 w-4" />
				) : (
					<MicOff className="h-4 w-4" />
				)}
			</Button>

			{/* Stop streaming */}
			<Button variant="destructive" onClick={stopScreenShare} className="gap-2">
				<StopCircle className="h-4 w-4" />
				Stop Sharing
			</Button>

			{/* Live indicator */}
			<div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500 text-white text-sm font-medium">
				<span className="relative flex h-2 w-2">
					<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
					<span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
				</span>
				LIVE
			</div>

			{/* Audio indicator */}
			{audioConfig !== "no-audio" && (
				<div className="text-xs text-text-tertiary">
					{audioConfig === "system-and-mic"
						? "System + Mic"
						: audioConfig === "system-only"
							? "System only"
							: ""}
				</div>
			)}
		</div>
	);
}
