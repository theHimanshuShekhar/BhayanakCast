/**
 * Room Event Handlers
 *
 * WebSocket event handlers for room operations.
 * Maintains in-memory state with synchronous DB persistence.
 *
 * @module websocket/room-events
 */

import type { Socket, Server as SocketIOServer } from "socket.io";
import {
	createRoomState,
	confirmRoomInDB,
	getRoomState,
	deleteRoomState,
	addParticipantToRoom,
	removeParticipantFromRoom,
	updateRoomStatus,
	updateRoomStreamer,
	getParticipantCount,
	isUserInRoom,
	getUserCurrentRoom,
	serializeRoomState,
	findStaleRooms,
	type ParticipantState,
} from "./room-state";
import {
	persistRoomCreation,
	persistParticipantJoin,
	persistParticipantLeave,
	persistStreamerTransfer,
	persistRoomEnd,
	getRoomFromDB,
	getActiveParticipantsFromDB,
} from "./db-persistence";

// Types for socket data
interface SocketUserData {
	userId?: string;
	userName?: string;
	userImage?: string;
	isMobile?: boolean;
}

// Extend Socket type
type TypedSocket = Socket & {
	data: SocketUserData;
};

/**
 * Setup room event handlers for a socket
 */
export function setupRoomEventHandlers(
	io: SocketIOServer,
	socket: TypedSocket,
): void {
	// Room creation
	socket.on("room:create", handleRoomCreate(socket));

	// Room join
	socket.on("room:join", handleRoomJoin(io, socket));

	// Room leave
	socket.on("room:leave", handleRoomLeave(io, socket));

	// Room rejoin (for reconnection)
	socket.on("room:rejoin", handleRoomRejoin(io, socket));

	// Streamer transfer
	socket.on("streamer:transfer", handleStreamerTransfer(io, socket));
}

/**
 * Handle room:create event
 */
function handleRoomCreate(socket: TypedSocket) {
	return async (data: { name: string; description?: string }) => {
		try {
			const userId = socket.data.userId;
			const userName = socket.data.userName;

			if (!userId) {
				socket.emit("room:create_error", {
					message: "Not authenticated",
				});
				return;
			}

			if (!data.name || data.name.trim().length < 3) {
				socket.emit("room:create_error", {
					message: "Room name must be at least 3 characters",
				});
				return;
			}

			console.log(`[RoomEvents] Creating room: ${data.name} by ${userName}`);

			// 1. Persist to database (SYNCHRONOUS)
			const roomResult = await persistRoomCreation({
				name: data.name.trim(),
				description: data.description?.trim(),
				userId,
			});

			// 2. Create in-memory state
			createRoomState({
				id: roomResult.roomId,
				name: roomResult.name,
				description: roomResult.description,
				streamerId: null,
				status: roomResult.status,
				createdAt: roomResult.createdAt,
			});

			confirmRoomInDB(roomResult.roomId);

			// 3. Add creator to in-memory state (already in DB from persistRoomCreation)
			const now = new Date();
			const participant: ParticipantState = {
				userId,
				userName: userName || "Unknown",
				userImage: socket.data.userImage,
				socketId: socket.id,
				joinedAt: now,
				isMobile: socket.data.isMobile || false,
			};

			addParticipantToRoom(roomResult.roomId, participant);

			// 4. Update room state - creator becomes streamer and room becomes "preparing"
			updateRoomStreamer(roomResult.roomId, userId);
			updateRoomStatus(roomResult.roomId, "preparing");

			// 5. Join socket to room
			socket.join(roomResult.roomId);

			// 6. Emit success
			socket.emit("room:created", {
				room: {
					id: roomResult.roomId,
					name: roomResult.name,
				description: roomResult.description,
				status: "preparing",
				streamerId: userId,
				createdAt: roomResult.createdAt,
			},
			participant: {
				userId,
				userName: participant.userName,
				joinedAt: now,
				isStreamer: true,
			},
			});

			console.log(
				`[RoomEvents] Room created: ${roomResult.name} (${roomResult.roomId})`,
			);
		} catch (error) {
			console.error("[RoomEvents] Room creation failed:", error);
			socket.emit("room:create_error", {
				message:
					error instanceof Error
						? error.message
						: "Failed to create room",
			});
		}
	};
}

/**
 * Handle room:join event
 */
function handleRoomJoin(io: SocketIOServer, socket: TypedSocket) {
	return async (data: { roomId: string }) => {
		try {
			const userId = socket.data.userId;
			const userName = socket.data.userName;
			const { roomId } = data;

			if (!userId) {
				socket.emit("room:join_error", {
					message: "Not authenticated",
				});
				return;
			}

			// Check if already in this room
			if (isUserInRoom(roomId, userId)) {
				socket.emit("room:join_error", {
					message: "Already in this room",
				});
				return;
			}

			// Check if in another room - leave it first
			const currentRoom = getUserCurrentRoom(userId);
			if (currentRoom && currentRoom.id !== roomId) {
				console.log(
					`[RoomEvents] User ${userId} leaving room ${currentRoom.id} to join ${roomId}`,
				);
				await persistParticipantLeave({
					roomId: currentRoom.id,
					userId,
				});
				removeParticipantFromRoom(currentRoom.id, userId);
				io.to(currentRoom.id).emit("room:user_left", {
					userId,
					userName,
					participantCount: getParticipantCount(currentRoom.id),
				});
				socket.leave(currentRoom.id);
			}

			console.log(`[RoomEvents] User ${userName} joining room ${roomId}`);

			// Check room exists in memory or DB
			let room = getRoomState(roomId);
			if (!room) {
				// Try to load from DB (room may exist but not in memory after restart)
				const dbRoom = await getRoomFromDB(roomId);
				if (dbRoom && dbRoom.status !== "ended") {
					room = createRoomState({
						id: dbRoom.id,
						name: dbRoom.name,
						description: dbRoom.description || undefined,
						streamerId: dbRoom.streamerId,
						status: dbRoom.status as
							| "waiting"
							| "preparing"
							| "active"
							| "ended",
						createdAt: dbRoom.createdAt,
					});
					confirmRoomInDB(roomId);

					// Load existing participants
					const dbParticipants = await getActiveParticipantsFromDB(roomId);
					for (const p of dbParticipants) {
						if (p.userId !== userId) {
							// Don't add the joining user yet
							addParticipantToRoom(roomId, {
								userId: p.userId,
								userName: p.userName,
								userImage: p.userImage || undefined,
								socketId: "", // Will be set when they rejoin
								joinedAt: p.joinedAt,
								isMobile: false,
							});
						}
					}
				} else {
					socket.emit("room:join_error", {
						message: "Room not found",
					});
					return;
				}
			}

			if (room.status === "ended") {
				socket.emit("room:join_error", {
					message: "Room has ended",
				});
				return;
			}

			// 1. Persist to database (SYNCHRONOUS)
			const joinResult = await persistParticipantJoin({
				roomId,
				userId,
			});

			// 2. Add to in-memory state
			const participant: ParticipantState = {
				userId,
				userName: userName || "Unknown",
				userImage: socket.data.userImage,
				socketId: socket.id,
				joinedAt: joinResult.joinedAt,
				isMobile: socket.data.isMobile || false,
			};

			addParticipantToRoom(roomId, participant);

			// Update streamer/status in memory if changed
			if (joinResult.becameStreamer) {
				updateRoomStreamer(roomId, userId);
				updateRoomStatus(roomId, "preparing");
			} else if (joinResult.isStreamer) {
				updateRoomStreamer(roomId, userId);
			}

			// Check if room became active
			const participantCount = getParticipantCount(roomId);
			if (room.status === "preparing" && participantCount >= 2) {
				updateRoomStatus(roomId, "active");
			}

			// 3. Join socket to room
			socket.join(roomId);

			// 4. Emit success to joining user (full state)
			const roomState = serializeRoomState(roomId);
			socket.emit("room:joined", {
				roomId,
				participant: {
					userId,
					userName: participant.userName,
					joinedAt: joinResult.joinedAt,
					isStreamer: joinResult.isStreamer,
				},
				roomState,
			});

			// 5. Broadcast to others
			socket.to(roomId).emit("room:user_joined", {
				userId,
				userName: participant.userName,
				participantCount,
				roomState,
			});

			// 6. If status changed, broadcast that too
			const currentStatus = getRoomState(roomId)?.status;
			if (currentStatus !== room.status) {
				io.to(roomId).emit("room:status_changed", {
					status: currentStatus,
				});
			}

			console.log(
				`[RoomEvents] User ${userName} joined room ${roomId} (${participantCount} participants)`,
			);
		} catch (error) {
			console.error("[RoomEvents] Room join failed:", error);
			socket.emit("room:join_error", {
				message:
					error instanceof Error
						? error.message
						: "Failed to join room",
			});
		}
	};
}

/**
 * Handle room:leave event
 */
function handleRoomLeave(io: SocketIOServer, socket: TypedSocket) {
	return async (data: { roomId: string }) => {
		try {
			const userId = socket.data.userId;
			const userName = socket.data.userName;
			const { roomId } = data;

			if (!userId) {
				socket.emit("room:error", { message: "Not authenticated" });
				return;
			}

			if (!isUserInRoom(roomId, userId)) {
				socket.emit("room:error", { message: "Not in room" });
				return;
			}

			console.log(`[RoomEvents] User ${userName} leaving room ${roomId}`);

			const room = getRoomState(roomId);
			const wasStreamer = room?.streamerId === userId;

			// 1. Persist to database (SYNCHRONOUS)
			const leaveResult = await persistParticipantLeave({
				roomId,
				userId,
			});

			// 2. Update in-memory state
			removeParticipantFromRoom(roomId, userId);

			// Update streamer if transferred
			if (leaveResult.newStreamerId) {
				updateRoomStreamer(roomId, leaveResult.newStreamerId);
			} else if (wasStreamer) {
				updateRoomStreamer(roomId, null);
			}

			// Update status
			if (leaveResult.roomStatus) {
				updateRoomStatus(roomId, leaveResult.roomStatus);
			}

			// 3. Leave socket room
			socket.leave(roomId);

			// 4. Get updated state
			const participantCount = getParticipantCount(roomId);
			const roomState = serializeRoomState(roomId);

			// 5. Broadcast to remaining users
			io.to(roomId).emit("room:user_left", {
				userId,
				userName,
				participantCount,
				newStreamerId: leaveResult.newStreamerId,
				newStreamerName: leaveResult.newStreamerId
					? getRoomState(roomId)?.participants.get(leaveResult.newStreamerId)
							?.userName
					: undefined,
				roomState,
			});

			// 6. If streamer changed, broadcast that too
			if (leaveResult.newStreamerId) {
				io.to(roomId).emit("room:streamer_changed", {
					newStreamerId: leaveResult.newStreamerId,
					newStreamerName: getRoomState(roomId)?.participants.get(
						leaveResult.newStreamerId,
					)?.userName,
				});
			}

			// 7. If status changed, broadcast that
			const currentStatus = getRoomState(roomId)?.status;
			if (currentStatus !== room?.status) {
				io.to(roomId).emit("room:status_changed", {
					status: currentStatus,
				});
			}

			console.log(
				`[RoomEvents] User ${userName} left room ${roomId} (${participantCount} remaining)`,
			);
		} catch (error) {
			console.error("[RoomEvents] Room leave failed:", error);
			socket.emit("room:error", {
				message:
					error instanceof Error
						? error.message
						: "Failed to leave room",
			});
		}
	};
}

/**
 * Handle room:rejoin event (for server restart recovery)
 */
function handleRoomRejoin(io: SocketIOServer, socket: TypedSocket) {
	return async (data: { roomId: string; userId: string }) => {
		try {
			const { roomId, userId } = data;
			const userName = socket.data.userName || "Unknown";

			console.log(`[RoomEvents] User ${userName} rejoining room ${roomId}`);

			// 1. Check if room exists in memory
			let room = getRoomState(roomId);

			if (!room) {
				// Room not in memory - rebuild from DB (server restarted)
				console.log(`[RoomEvents] Rebuilding room ${roomId} from database`);

				const dbRoom = await getRoomFromDB(roomId);
				if (!dbRoom || dbRoom.status === "ended") {
					socket.emit("room:join_error", {
						message: "Room not found or has ended",
					});
					return;
				}

				// Create in-memory state from DB
				room = createRoomState({
					id: dbRoom.id,
					name: dbRoom.name,
					description: dbRoom.description || undefined,
					streamerId: dbRoom.streamerId,
					status: dbRoom.status as
						| "waiting"
						| "preparing"
						| "active"
						| "ended",
					createdAt: dbRoom.createdAt,
				});
				confirmRoomInDB(roomId);

				// Load existing participants from DB
				const dbParticipants = await getActiveParticipantsFromDB(roomId);
				for (const p of dbParticipants) {
					if (p.userId !== userId) {
						// Don't add rejoining user yet
						addParticipantToRoom(roomId, {
							userId: p.userId,
							userName: p.userName,
							userImage: p.userImage || undefined,
							socketId: "", // Unknown until they rejoin
							joinedAt: p.joinedAt,
							isMobile: false,
						});
					}
				}
			}

			// 2. Update participant info (may be reconnecting)
			const existingParticipant = room.participants.get(userId);
			const participant: ParticipantState = {
				userId,
				userName: existingParticipant?.userName || userName,
				userImage: socket.data.userImage || existingParticipant?.userImage,
				socketId: socket.id,
				joinedAt: existingParticipant?.joinedAt || new Date(),
				isMobile: socket.data.isMobile || false,
			};

			room.participants.set(userId, participant);

			// 3. Join socket to room
			socket.join(roomId);

			// 4. Emit full state to rejoining user
			const roomState = serializeRoomState(roomId);
			socket.emit("room:state_sync", {
				roomId,
				roomState,
				yourParticipantId: userId,
			});

			// 5. Broadcast to others (if not already in room)
			if (!existingParticipant) {
				io.to(roomId).emit("room:user_joined", {
					userId,
					userName: participant.userName,
					participantCount: getParticipantCount(roomId),
					roomState,
				});
			}

			console.log(
				`[RoomEvents] User ${userName} rejoined room ${roomId} (${getParticipantCount(roomId)} participants)`,
			);
		} catch (error) {
			console.error("[RoomEvents] Room rejoin failed:", error);
			socket.emit("room:join_error", {
				message:
					error instanceof Error
						? error.message
						: "Failed to rejoin room",
			});
		}
	};
}

/**
 * Handle streamer:transfer event
 */
function handleStreamerTransfer(io: SocketIOServer, socket: TypedSocket) {
	return async (data: { roomId: string; newStreamerId: string }) => {
		try {
			const userId = socket.data.userId;
			const { roomId, newStreamerId } = data;

			if (!userId) {
				socket.emit("room:error", { message: "Not authenticated" });
				return;
			}

			const room = getRoomState(roomId);
			if (!room) {
				socket.emit("room:error", { message: "Room not found" });
				return;
			}

			// Check if current streamer
			if (room.streamerId !== userId) {
				socket.emit("room:error", {
					message: "Only the streamer can transfer ownership",
				});
				return;
			}

			// Check if new streamer is in room
			const newStreamer = room.participants.get(newStreamerId);
			if (!newStreamer) {
				socket.emit("room:error", {
					message: "New streamer is not in the room",
				});
				return;
			}

			console.log(
				`[RoomEvents] Transferring streamer in ${roomId} to ${newStreamer.userName}`,
			);

			// 1. Persist to database (SYNCHRONOUS)
			await persistStreamerTransfer(roomId, newStreamerId);

			// 2. Update in-memory state
			updateRoomStreamer(roomId, newStreamerId);

			// 3. Broadcast to all room members
			io.to(roomId).emit("room:streamer_changed", {
				newStreamerId,
				newStreamerName: newStreamer.userName,
			});

			console.log(
				`[RoomEvents] Streamer transferred in ${roomId} to ${newStreamer.userName}`,
			);
		} catch (error) {
			console.error("[RoomEvents] Streamer transfer failed:", error);
			socket.emit("room:error", {
				message:
					error instanceof Error
						? error.message
						: "Failed to transfer streamer",
			});
		}
	};
}

/**
 * Run cleanup job - end stale rooms
 */
export async function runRoomCleanupJob(
	io: SocketIOServer,
): Promise<number> {
	console.log("[RoomEvents] Running cleanup job...");

	const staleRooms = findStaleRooms(5);

	if (staleRooms.length === 0) {
		console.log("[RoomEvents] No stale rooms to clean up");
		return 0;
	}

	console.log(`[RoomEvents] Found ${staleRooms.length} stale rooms`);

	for (const { id, name } of staleRooms) {
		try {
			console.log(`[RoomEvents] Ending room: ${name} (${id})`);

			// 1. Persist to database
			await persistRoomEnd(id);

			// 2. Remove from memory
			deleteRoomState(id);

			// 3. Notify any connected clients
			io.to(id).emit("room:ended", { roomId: id });
		} catch (error) {
			console.error(`[RoomEvents] Failed to end room ${id}:`, error);
		}
	}

	console.log("[RoomEvents] Cleanup job completed");
	return staleRooms.length;
}

/**
 * Handle socket disconnect - auto-leave rooms
 */
export async function handleSocketDisconnect(
	io: SocketIOServer,
	socket: TypedSocket,
	sendSystemMessage?: (roomId: string, content: string) => void,
	initiateWebRTCTransfer?: (
		roomId: string,
		oldStreamerId: string,
		newStreamerId: string,
		participants: Array<{ userId: string; userName: string }>,
	) => Promise<void>,
	getWebRTCState?: (roomId: string) => { streamerId: string | null } | undefined,
): Promise<void> {
	const userId = socket.data.userId;
	if (!userId) return;

	// Find rooms this socket was in
	for (const roomId of socket.rooms) {
		if (roomId === socket.id) continue; // Skip default room

		const room = getRoomState(roomId);
		if (!room) continue;

		const participant = room.participants.get(userId);
		if (participant && participant.socketId === socket.id) {
			console.log(
				`[RoomEvents] User ${participant.userName} disconnected from ${roomId}`,
			);

			try {
				// Leave the room
				const leaveResult = await persistParticipantLeave({
					roomId,
					userId,
				});

				// Update in-memory state
				removeParticipantFromRoom(roomId, userId);

				if (leaveResult.newStreamerId) {
					updateRoomStreamer(roomId, leaveResult.newStreamerId);
				} else if (room.streamerId === userId) {
					updateRoomStreamer(roomId, null);
				}

				if (leaveResult.roomStatus) {
					updateRoomStatus(roomId, leaveResult.roomStatus);
				}

				// Broadcast
				const participantCount = getParticipantCount(roomId);
				const roomState = serializeRoomState(roomId);

				io.to(roomId).emit("room:user_left", {
					userId,
					userName: participant.userName,
					participantCount,
					newStreamerId: leaveResult.newStreamerId,
					newStreamerName: leaveResult.newStreamerId
						? room.participants.get(leaveResult.newStreamerId)?.userName
						: undefined,
					roomState,
				});

				// Send system message
				if (sendSystemMessage) {
					sendSystemMessage(roomId, `${participant.userName} left the room`);
				}

				if (leaveResult.newStreamerId) {
					const newStreamerName = room.participants.get(leaveResult.newStreamerId)?.userName || "Someone";
					io.to(roomId).emit("room:streamer_changed", {
						newStreamerId: leaveResult.newStreamerId,
						newStreamerName,
					});

					// Send system message for streamer change
					if (sendSystemMessage) {
						sendSystemMessage(roomId, `${newStreamerName} is now the streamer`);
					}

					// Initiate WebRTC transfer if old streamer was streaming
					if (initiateWebRTCTransfer && getWebRTCState) {
						const webrtcState = getWebRTCState(roomId);
						if (webrtcState && webrtcState.streamerId === userId) {
							const participantsList = Array.from(room.participants.values()).map(
								(p) => ({ userId: p.userId, userName: p.userName }),
							);
							await initiateWebRTCTransfer(
								roomId,
								userId,
								leaveResult.newStreamerId,
								participantsList,
							);
						}
					}
				}

				if (getRoomState(roomId)?.status !== room.status) {
					io.to(roomId).emit("room:status_changed", {
						status: getRoomState(roomId)?.status,
					});
				}
			} catch (error) {
				console.error(`[RoomEvents] Disconnect handling failed:`, error);
			}
		}
	}
}

export type { TypedSocket };
