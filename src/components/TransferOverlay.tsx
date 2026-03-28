/**
 * TransferOverlay
 *
 * Full-video overlay shown during streamer transfers.
 * Appears when the current streamer leaves and a new one is taking over.
 *
 * @module components/TransferOverlay
 */

import { ArrowLeftRight, RefreshCw } from "lucide-react";

export interface TransferOverlayProps {
	isTransferring: boolean;
	oldStreamerName?: string;
	newStreamerName?: string;
}

export function TransferOverlay({
	isTransferring,
	oldStreamerName,
	newStreamerName,
}: TransferOverlayProps) {
	if (!isTransferring) return null;

	return (
		<div
			className="absolute inset-0 bg-black/75 flex flex-col items-center justify-center rounded-xl"
			data-testid="transfer-overlay"
		>
			<ArrowLeftRight className="h-12 w-12 text-accent mb-4" />
			<h3 className="text-white text-xl font-semibold mb-2">Streamer Changed</h3>
			{oldStreamerName && (
				<p className="text-gray-300 text-sm mb-1">
					{oldStreamerName} has left
				</p>
			)}
			{newStreamerName && (
				<p className="text-gray-300 text-sm mb-4">
					{newStreamerName} is now streaming
				</p>
			)}
			{!newStreamerName && (
				<p className="text-gray-300 text-sm mb-4">
					Waiting for new streamer...
				</p>
			)}
			<div className="flex items-center gap-2 text-accent text-sm">
				<RefreshCw className="h-4 w-4 animate-spin" />
				<span>Connecting to new stream...</span>
			</div>
		</div>
	);
}
