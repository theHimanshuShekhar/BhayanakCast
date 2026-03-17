/**
 * Room State Hook
 *
 * Manages room state via WebSocket events for WebSocket-first architecture.
 * Replaces direct database queries with WebSocket subscriptions.
 *
 * @module hooks/useRoom
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useWebSocket } from "#/lib/websocket-context";

export interface RoomParticipant {
	userId: string;
	userName: string;
	userImage?: string;
	joinedAt: Date;
	isMobile: boolean;
}

export interface RoomState {
	id: string;
	name: string;
	description?: string;
	status: "waiting" | "preparing" | "active" | "ended";
	streamerId: string | null;
	participants: RoomParticipant[];
	createdAt: Date;
}

export interface UseRoomReturn {
	// State
	roomState: RoomState | null;
	isLoading: boolean;
	isJoined: boolean;
	isStreamer: boolean;
	error: string | null;

	// Actions
	joinRoom: () => void;
	leaveRoom: () => void;
	transferStreamer: (newStreamerId: string) => void;
}

/**
 * Hook to manage room state via WebSocket
 */
export function useRoom(roomId: string | undefined): UseRoomReturn {
	const { socket, userId } = useWebSocket();
	const [roomState, setRoomState] = useState<RoomState | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isJoined, setIsJoined] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const hasJoinedRef = useRef(false);

	const isStreamer =
		userId && roomState ? roomState.streamerId === userId : false;

	// Join room
	const joinRoom = useCallback(() => {
		if (!socket || !roomId || !userId) {
			setError("Cannot join room - missing required data");
			return;
		}

		if (hasJoinedRef.current) {
			console.log("[useRoom] Already joined or joining room");
			return;
		}

		hasJoinedRef.current = true;
		setIsLoading(true);
		setError(null);

		console.log("[useRoom] Emitting room:join", { roomId });
		socket.emit("room:join", { roomId });
	}, [socket, roomId, userId]);

	// Leave room
	const leaveRoom = useCallback(() => {
		if (!socket || !roomId) return;

		console.log("[useRoom] Emitting room:leave", { roomId });
		socket.emit("room:leave", { roomId });
		hasJoinedRef.current = false;
		setIsJoined(false);
	}, [socket, roomId]);

	// Transfer streamer ownership
	const transferStreamer = useCallback(
		(newStreamerId: string) => {
			if (!socket || !roomId) return;

			console.log("[useRoom] Emitting streamer:transfer", {
				roomId,
				newStreamerId,
			});
			socket.emit("streamer:transfer", { roomId, newStreamerId });
		},
		[socket, roomId],
	);

	// Setup event listeners
	useEffect(() => {
		if (!socket || !roomId || !userId) {
			setIsLoading(false);
			return;
		}

		console.log("[useRoom] Setting up event listeners for room", roomId);

		// Successfully joined room
		const handleRoomJoined = (data: {
			roomId: string;
			participant: RoomParticipant & { isStreamer: boolean };
			roomState: RoomState;
		}) => {
			if (data.roomId !== roomId) return;

			console.log("[useRoom] Room joined:", data.roomState.name);
			setRoomState(data.roomState);
			setIsJoined(true);
			setIsLoading(false);
			setError(null);
		};

		// Full state sync (for rejoins)
		const handleStateSync = (data: {
			roomId: string;
			roomState: RoomState;
		}) => {
			if (data.roomId !== roomId) return;

			console.log("[useRoom] State synced:", data.roomState.name);
			setRoomState(data.roomState);
			setIsJoined(true);
			setIsLoading(false);
			setError(null);
		};

		// User joined
		const handleUserJoined = (data: {
			userId: string;
			userName: string;
			participantCount: number;
			roomState: RoomState;
		}) => {
			if (!roomState || data.roomState.id !== roomId) return;

			console.log("[useRoom] User joined:", data.userName);
			setRoomState(data.roomState);
		};

		// User left
		const handleUserLeft = (data: {
			userId: string;
			userName: string;
			participantCount: number;
			newStreamerId?: string;
			newStreamerName?: string;
			roomState: RoomState;
		}) => {
			if (!roomState || data.roomState.id !== roomId) return;

			console.log("[useRoom] User left:", data.userName);
			setRoomState(data.roomState);
		};

		// Streamer changed
		const handleStreamerChanged = (data: {
			newStreamerId: string;
			newStreamerName: string;
		}) => {
			if (!roomState) return;

			console.log("[useRoom] Streamer changed:", data.newStreamerName);
			setRoomState((prev) =>
				prev
					? {
							...prev,
							streamerId: data.newStreamerId,
						}
					: null,
			);
		};

		// Room status changed
		const handleStatusChanged = (data: { status: RoomState["status"] }) => {
			if (!roomState) return;

			console.log("[useRoom] Status changed:", data.status);
			setRoomState((prev) =>
				prev
					? {
							...prev,
							status: data.status,
						}
					: null,
			);
		};

		// Room ended
		const handleRoomEnded = (data: { roomId: string }) => {
			if (data.roomId !== roomId) return;

			console.log("[useRoom] Room ended");
			setRoomState((prev) =>
				prev
					? {
							...prev,
							status: "ended",
						}
					: null,
			);
			hasJoinedRef.current = false;
			setIsJoined(false);
		};

		// Error handling
		const handleJoinError = (data: { message: string }) => {
			console.error("[useRoom] Join error:", data.message);
			setError(data.message);
			setIsLoading(false);
			hasJoinedRef.current = false;
		};

		const handleRoomError = (data: { message: string }) => {
			console.error("[useRoom] Room error:", data.message);
			setError(data.message);
		};

		// Register listeners
		socket.on("room:joined", handleRoomJoined);
		socket.on("room:state_sync", handleStateSync);
		socket.on("room:user_joined", handleUserJoined);
		socket.on("room:user_left", handleUserLeft);
		socket.on("room:streamer_changed", handleStreamerChanged);
		socket.on("room:status_changed", handleStatusChanged);
		socket.on("room:ended", handleRoomEnded);
		socket.on("room:join_error", handleJoinError);
		socket.on("room:error", handleRoomError);

		// Auto-join on mount if not already joined
		if (!hasJoinedRef.current && !isJoined) {
			joinRoom();
		}

		return () => {
			console.log("[useRoom] Cleaning up event listeners");
			socket.off("room:joined", handleRoomJoined);
			socket.off("room:state_sync", handleStateSync);
			socket.off("room:user_joined", handleUserJoined);
			socket.off("room:user_left", handleUserLeft);
			socket.off("room:streamer_changed", handleStreamerChanged);
			socket.off("room:status_changed", handleStatusChanged);
			socket.off("room:ended", handleRoomEnded);
			socket.off("room:join_error", handleJoinError);
			socket.off("room:error", handleRoomError);
		};
	}, [socket, roomId, userId, joinRoom, isJoined, roomState]);

	return {
		roomState,
		isLoading,
		isJoined,
		isStreamer,
		error,
		joinRoom,
		leaveRoom,
		transferStreamer,
	};
}
