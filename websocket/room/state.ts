/**
 * Room State Management
 *
 * In-memory room state for WebSocket-first architecture.
 * Database is the persistence layer - all writes wait for DB confirmation.
 *
 * @module websocket/room-state
 */

// Types
export interface RoomState {
	id: string;
	name: string;
	description?: string;
	streamerId: string | null;
	streamerPeerId: string | null; // PeerJS ID for late joiners
	status: "waiting" | "preparing" | "active" | "ended";
	participants: Map<string, ParticipantState>;
	createdAt: Date;
	dbConfirmed: boolean;
}

export interface ParticipantState {
	userId: string;
	userName: string;
	userImage?: string;
	socketId: string;
	joinedAt: Date;
	isMobile: boolean;
}

export interface SerializedParticipant {
	userId: string;
	userName: string;
	userImage: string | null;
	joinedAt: Date;
	isMobile: boolean;
	totalTimeSeconds: number;
}

export interface SerializedRoomState {
	id: string;
	name: string;
	description?: string;
	streamerId: string | null;
	streamerPeerId: string | null; // PeerJS ID for late joiners
	status: "waiting" | "preparing" | "active" | "ended";
	participants: SerializedParticipant[];
	createdAt: Date;
}

// Global state store
const roomStates = new Map<string, RoomState>();

// Debug mode
const DEBUG = process.env.DEBUG_ROOMS === "true";

/**
 * Create a new room state in memory
 * Note: DB persistence happens separately
 */
export function createRoomState(data: {
	id: string;
	name: string;
	description?: string;
	streamerId: string | null;
	status: "waiting" | "preparing" | "active" | "ended";
	createdAt: Date;
}): RoomState {
	const room: RoomState = {
		...data,
		streamerPeerId: null,
		participants: new Map(),
		dbConfirmed: false,
	};

	roomStates.set(data.id, room);

	if (DEBUG) {
		console.log(`[RoomState] Created room: ${data.name} (${data.id})`);
	}

	return room;
}

/**
 * Mark room as DB confirmed after successful DB write
 */
export function confirmRoomInDB(roomId: string): void {
	const room = roomStates.get(roomId);
	if (room) {
		room.dbConfirmed = true;
		if (DEBUG) {
			console.log(`[RoomState] Room confirmed in DB: ${roomId}`);
		}
	}
}

/**
 * Get room state by ID
 */
export function getRoomState(roomId: string): RoomState | undefined {
	return roomStates.get(roomId);
}

/**
 * Check if room exists in memory
 */
export function hasRoomState(roomId: string): boolean {
	return roomStates.has(roomId);
}

/**
 * Delete room state (when room ends)
 */
export function deleteRoomState(roomId: string): boolean {
	const deleted = roomStates.delete(roomId);
	if (deleted && DEBUG) {
		console.log(`[RoomState] Deleted room: ${roomId}`);
	}
	return deleted;
}

/**
 * Add participant to room
 */
export function addParticipantToRoom(
	roomId: string,
	participant: ParticipantState,
): boolean {
	const room = roomStates.get(roomId);
	if (!room) {
		console.error(`[RoomState] Cannot add participant - room not found: ${roomId}`);
		return false;
	}

	if (room.status === "ended") {
		console.error(`[RoomState] Cannot add participant - room ended: ${roomId}`);
		return false;
	}

	room.participants.set(participant.userId, participant);

	if (DEBUG) {
		console.log(
			`[RoomState] Added ${participant.userName} to ${room.name} (${roomId})`,
		);
	}

	return true;
}

/**
 * Remove participant from room
 */
export function removeParticipantFromRoom(
	roomId: string,
	userId: string,
): ParticipantState | undefined {
	const room = roomStates.get(roomId);
	if (!room) return undefined;

	const participant = room.participants.get(userId);
	if (participant) {
		room.participants.delete(userId);

		if (DEBUG) {
			console.log(
				`[RoomState] Removed ${participant.userName} from ${room.name} (${roomId})`,
			);
		}
	}

	return participant;
}

/**
 * Get participant from room
 */
export function getParticipant(
	roomId: string,
	userId: string,
): ParticipantState | undefined {
	const room = roomStates.get(roomId);
	return room?.participants.get(userId);
}

/**
 * Update room status
 */
export function updateRoomStatus(
	roomId: string,
	status: "waiting" | "preparing" | "active" | "ended",
): boolean {
	const room = roomStates.get(roomId);
	if (!room) return false;

	const oldStatus = room.status;
	room.status = status;

	if (DEBUG) {
		console.log(
			`[RoomState] ${roomId}: ${oldStatus} → ${status}`,
		);
	}

	return true;
}

/**
 * Update streamer assignment
 */
export function updateRoomStreamer(
	roomId: string,
	streamerId: string | null,
): boolean {
	const room = roomStates.get(roomId);
	if (!room) return false;

	const oldStreamer = room.streamerId;
	room.streamerId = streamerId;

	// Clear peer ID when streamer changes (new streamer will set their own)
	if (oldStreamer !== streamerId) {
		room.streamerPeerId = null;
	}

	if (DEBUG) {
		console.log(
			`[RoomState] ${roomId}: streamer ${oldStreamer} → ${streamerId}`,
		);
	}

	return true;
}

/**
 * Get all participants in room
 */
export function getRoomParticipantsList(
	roomId: string,
): ParticipantState[] {
	const room = roomStates.get(roomId);
	if (!room) return [];
	return Array.from(room.participants.values());
}

/**
 * Get participant count
 */
export function getParticipantCount(roomId: string): number {
	const room = roomStates.get(roomId);
	return room?.participants.size || 0;
}

/**
 * Check if user is in room
 */
export function isUserInRoom(roomId: string, userId: string): boolean {
	const room = roomStates.get(roomId);
	return room ? room.participants.has(userId) : false;
}

/**
 * Get user's current room
 */
export function getUserCurrentRoom(userId: string): RoomState | undefined {
	for (const room of roomStates.values()) {
		if (room.participants.has(userId)) {
			return room;
		}
	}
	return undefined;
}

/**
 * Serialize room state for transmission
 */
export function serializeRoomState(
	roomId: string,
): SerializedRoomState | null {
	const room = roomStates.get(roomId);
	if (!room) return null;

	return {
		id: room.id,
		name: room.name,
		description: room.description,
		streamerId: room.streamerId,
		streamerPeerId: room.streamerPeerId,
		status: room.status,
		participants: Array.from(room.participants.values()).map((p) => ({
			userId: p.userId,
			userName: p.userName,
			userImage: p.userImage ?? null,
			joinedAt: p.joinedAt,
			isMobile: p.isMobile,
			totalTimeSeconds: Math.floor((Date.now() - p.joinedAt.getTime()) / 1000),
		})),
		createdAt: room.createdAt,
	};
}

/**
 * Get all active room IDs
 */
export function getActiveRoomIds(): string[] {
	return Array.from(roomStates.entries())
		.filter(([, room]) => room.status !== "ended")
		.map(([id]) => id);
}

/**
 * Find rooms that should be ended (empty waiting rooms)
 */
export function findStaleRooms(
	maxAgeMinutes: number = 5,
): Array<{ id: string; name: string }> {
	const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
	const stale: Array<{ id: string; name: string }> = [];

	for (const [id, room] of roomStates) {
		if (
			room.status === "waiting" &&
			room.participants.size === 0 &&
			room.createdAt < cutoff
		) {
			stale.push({ id, name: room.name });
		}
	}

	return stale;
}

/**
 * Debug: Log all room states
 */
export function debugRoomStates(): void {
	if (!DEBUG) return;

	console.log("[RoomState:All]", {
		count: roomStates.size,
		rooms: Array.from(roomStates.entries()).map(([id, room]) => ({
			id,
			name: room.name,
			status: room.status,
			participants: room.participants.size,
			dbConfirmed: room.dbConfirmed,
		})),
	});
}

/**
 * Debug: Log specific room state
 */
export function debugRoomState(roomId: string): void {
	if (!DEBUG) return;

	const room = roomStates.get(roomId);
	if (room) {
		console.log(`[RoomState:${roomId}]`, {
			name: room.name,
			status: room.status,
			streamerId: room.streamerId,
		streamerPeerId: room.streamerPeerId,
			participants: Array.from(room.participants.entries()).map(
				([uid, p]) => ({
					userId: uid,
					userName: p.userName,
					socketId: p.socketId,
				}),
			),
			dbConfirmed: room.dbConfirmed,
		});
	} else {
		console.log(`[RoomState:${roomId}] Room not found`);
	}
}

/**
 * Clear all room states (useful for testing)
 */
export function clearAllRoomStates(): void {
	roomStates.clear();
	if (DEBUG) {
		console.log("[RoomState] All room states cleared");
	}
}

// Export the map for advanced use cases (read-only)
export { roomStates };
