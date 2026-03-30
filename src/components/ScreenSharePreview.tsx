/**
 * ScreenSharePreview
 *
 * Streamer-facing video component showing the local screen share.
 * Displays a "Ready to Stream" placeholder when no stream is active,
 * and a live preview with a LIVE badge when streaming.
 *
 * @module components/ScreenSharePreview
 */

import { Monitor } from "lucide-react";
import { useEffect, useRef } from "react";

export interface ScreenSharePreviewProps {
	stream: MediaStream | null;
}

export function ScreenSharePreview({ stream }: ScreenSharePreviewProps) {
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
