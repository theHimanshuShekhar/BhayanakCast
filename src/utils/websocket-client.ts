/**
 * Broadcast a room event via HTTP to the WebSocket server
 * This is used by server functions to emit events to connected clients
 */
export async function broadcastRoomEvent(
	roomId: string,
	event: string,
	data: unknown,
): Promise<void> {
	const wsUrl = process.env.WS_URL || "http://localhost:3001";

	try {
		const response = await fetch(`${wsUrl}/api/broadcast`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ roomId, event, data }),
		});

		if (!response.ok) {
			console.error(
				`[Broadcast] Failed to broadcast event: ${response.status}`,
			);
		}
	} catch (error) {
		console.error("[Broadcast] Error broadcasting event:", error);
	}
}

/**
 * Notify room that a user joined
 */
export async function broadcastRoomJoin(
	roomId: string,
	userId: string,
): Promise<void> {
	await broadcastRoomEvent(roomId, "room:join", { userId });
}

/**
 * Notify room that a user left
 */
export async function broadcastRoomLeave(
	roomId: string,
	userId: string,
): Promise<void> {
	await broadcastRoomEvent(roomId, "room:leave", { userId });
}

/**
 * Notify room that streamer changed
 */
export async function broadcastStreamerChanged(
	roomId: string,
	newStreamerId: string,
): Promise<void> {
	await broadcastRoomEvent(roomId, "room:streamer_changed", {
		newStreamerId,
	});
}
