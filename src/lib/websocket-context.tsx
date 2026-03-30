import { debounce } from "@tanstack/pacer";
import { useQuery } from "@tanstack/react-query";
import type React from "react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { io, type Socket } from "socket.io-client";
import { authClient } from "#/lib/auth-client";
import { getRuntimeConfig } from "#/utils/runtime-config";

interface WebSocketContextType {
	socket: Socket | null;
	isConnected: boolean;
	userCount: number;
	userId: string | null;
	currentRoomId: string | null;
	setCurrentRoomId: (roomId: string | null) => void;
	sendMessage: (message: unknown) => void;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(
	undefined,
);

const ANONYMOUS_USER_KEY = "bhayanak_anonymous_user_id";

/**
 * Get or create a persistent anonymous user ID from localStorage.
 * This allows tracking unique anonymous users across tabs.
 */
function getAnonymousUserId(): string {
	if (typeof window === "undefined") return "";

	let anonymousId = localStorage.getItem(ANONYMOUS_USER_KEY);
	if (!anonymousId) {
		// Generate a UUID-like string
		anonymousId = `anon_${crypto.randomUUID()}`;
		localStorage.setItem(ANONYMOUS_USER_KEY, anonymousId);
	}
	return anonymousId;
}

/**
 * Get the effective user ID for WebSocket identification.
 * Returns the logged-in user ID if available, otherwise the anonymous ID.
 */
function getEffectiveUserId(sessionUserId: string | undefined): string {
	if (sessionUserId) return sessionUserId;
	return getAnonymousUserId();
}

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
	const [isConnected, setIsConnected] = useState(false);
	const [userCount, setUserCount] = useState(0);
	const [userId, setUserId] = useState<string | null>(null);
	const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
	// Ref mirrors state so the connect handler always reads the latest roomId
	// without triggering a full socket teardown on every room navigation
	const currentRoomIdRef = useRef<string | null>(null);
	const socketRef = useRef<Socket | null>(null);
	const debouncedUpdateRef = useRef<((count: number) => void) | null>(null);
	const { data: session } = authClient.useSession();
	// Refs for session metadata so the connect handler can read up-to-date values
	// without adding them to the socket effect's dep array (which would tear down
	// and recreate the socket — and evict the user from their room — on profile updates)
	const sessionNameRef = useRef<string | undefined>(session?.user?.name);
	const sessionImageRef = useRef<string | null | undefined>(
		session?.user?.image,
	);

	// Fetch runtime configuration from server
	const { data: runtimeConfig } = useQuery({
		queryKey: ["runtimeConfig"],
		queryFn: () => getRuntimeConfig(),
		staleTime: Infinity, // Config doesn't change during session
		gcTime: Infinity,
	});

	const wsUrl = runtimeConfig?.wsUrl || "http://localhost:3001";

	// Keep refs in sync whenever values change (no socket teardown side-effect)
	useEffect(() => {
		currentRoomIdRef.current = currentRoomId;
	}, [currentRoomId]);
	useEffect(() => {
		sessionNameRef.current = session?.user?.name;
		sessionImageRef.current = session?.user?.image;
	}, [session?.user?.name, session?.user?.image]);

	useEffect(() => {
		if (typeof window === "undefined" || !wsUrl) {
			return;
		}

		// Create debounced update function
		debouncedUpdateRef.current = debounce(
			(count: number) => {
				setUserCount(count);
			},
			{ wait: 300 },
		);

		const socket = io(wsUrl, {
			transports: ["websocket", "polling"],
			autoConnect: true,
			reconnection: true,
			reconnectionAttempts: 5,
			reconnectionDelay: 1000,
		});

		socketRef.current = socket;

		socket.on("connect", () => {
			setIsConnected(true);
			// Read session identity from refs — avoids adding name/image to deps
			// which would tear down the socket on every profile update
			const effectiveUserId = getEffectiveUserId(session?.user?.id);
			setUserId(effectiveUserId);
			socket.emit("identify", {
				userId: effectiveUserId,
				userName: sessionNameRef.current || effectiveUserId,
				userImage: sessionImageRef.current,
			});

			// Auto-rejoin room if we were in one before disconnect.
			// Read from ref (not closure) so this doesn't add currentRoomId to deps
			// which would tear down and recreate the socket on every room navigation.
			const roomId = currentRoomIdRef.current;
			if (roomId && effectiveUserId) {
				console.log("[WebSocket] Auto-rejoining room:", roomId);
				socket.emit("room:rejoin", {
					roomId,
					userId: effectiveUserId,
				});
			}
		});

		socket.on("disconnect", () => {
			setIsConnected(false);
		});

		socket.on("userCount", (data: { count: number }) => {
			debouncedUpdateRef.current?.(data.count);
		});

		return () => {
			socket.disconnect();
		};
	}, [
		wsUrl,
		session?.user?.id,
		// session.user.name / image intentionally excluded: profile-metadata changes
		// are handled by the re-identify effect below without tearing down the socket
		// and evicting the user from their room.
		// currentRoomId intentionally excluded: changes are tracked via currentRoomIdRef.
	]);

	// Re-identify when session changes (user logs in/out)
	useEffect(() => {
		const socket = socketRef.current;
		if (socket?.connected) {
			const userId = getEffectiveUserId(session?.user?.id);
			socket.emit("identify", {
				userId,
				userName: session?.user?.name || userId,
				userImage: session?.user?.image,
			});
		}
	}, [session?.user?.id, session?.user?.name, session?.user?.image]);

	const sendMessage = useCallback((message: unknown) => {
		if (socketRef.current?.connected) {
			socketRef.current.emit("message", message);
		}
	}, []);

	return (
		<WebSocketContext.Provider
			value={{
				socket: socketRef.current,
				isConnected,
				userCount,
				userId,
				currentRoomId,
				setCurrentRoomId,
				sendMessage,
			}}
		>
			{children}
		</WebSocketContext.Provider>
	);
}

export function useWebSocket() {
	const context = useContext(WebSocketContext);
	if (context === undefined) {
		throw new Error("useWebSocket must be used within a WebSocketProvider");
	}
	return context;
}
