/**
 * VideoDisplay
 *
 * Viewer-facing video component with connection status overlays.
 * Shows different UI depending on whether the stream is loading,
 * retrying, failed, or connected.
 *
 * @module components/VideoDisplay
 */

import { Monitor, RefreshCw, Video, WifiOff } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ConnectionStatus } from "#/types/webrtc";

export interface VideoDisplayProps {
	stream: MediaStream | null;
	streamerName?: string | null;
	connectionStatus?: ConnectionStatus;
	retryAttempt?: number;
}

export function VideoDisplay({
	stream,
	streamerName,
	connectionStatus = "idle",
	retryAttempt = 0,
}: VideoDisplayProps) {
	const videoRef = useRef<HTMLVideoElement>(null);

	useEffect(() => {
		if (videoRef.current && stream) {
			videoRef.current.srcObject = stream;
		}
	}, [stream]);

	if (!stream) {
		return (
			<div className="bg-depth-2 rounded-xl aspect-video flex flex-col items-center justify-center border-2 border-dashed border-border-subtle">
				{connectionStatus === "connecting" ||
				connectionStatus === "reconnecting" ? (
					<>
						<RefreshCw className="h-16 w-16 text-accent mb-4 animate-spin" />
						<p className="text-text-secondary text-lg mb-2">
							Connecting to stream...
						</p>
						{retryAttempt > 0 && (
							<p className="text-text-tertiary text-sm">
								Retry attempt {retryAttempt}
							</p>
						)}
					</>
				) : connectionStatus === "failed" ? (
					<>
						<WifiOff className="h-16 w-16 text-danger mb-4" />
						<p className="text-text-secondary text-lg mb-2">
							Connection failed
						</p>
						<p className="text-text-tertiary text-sm">
							Attempting to reconnect...
						</p>
					</>
				) : (
					<>
						<Video className="h-16 w-16 text-text-tertiary mb-4" />
						<p className="text-text-secondary text-lg mb-2">
							Waiting for Stream
						</p>
						<p className="text-text-tertiary text-sm">
							{streamerName
								? `${streamerName} will start streaming soon`
								: "No streamer yet"}
						</p>
					</>
				)}
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
