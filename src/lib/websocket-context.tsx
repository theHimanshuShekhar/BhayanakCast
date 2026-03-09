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
	const socketRef = useRef<Socket | null>(null);
	const debouncedUpdateRef = useRef<((count: number) => void) | null>(null);
	const { data: session } = authClient.useSession();

	// Fetch runtime configuration from server
	const { data: runtimeConfig } = useQuery({
		queryKey: ["runtimeConfig"],
		queryFn: () => getRuntimeConfig(),
		staleTime: Infinity, // Config doesn't change during session
		gcTime: Infinity,
	});

	const wsUrl = runtimeConfig?.wsUrl || "http://localhost:3001";

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
			// Identify the user after connection
			const userId = getEffectiveUserId(session?.user?.id);
			socket.emit("identify", {
				userId,
				userName: session?.user?.name || userId,
				userImage: session?.user?.image,
			});
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
	}, [wsUrl, session?.user?.id, session?.user?.name, session?.user?.image]);

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
