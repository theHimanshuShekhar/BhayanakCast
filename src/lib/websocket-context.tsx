import { debounce } from "@tanstack/pacer";
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

interface WebSocketContextType {
	socket: Socket | null;
	isConnected: boolean;
	userCount: number;
	sendMessage: (message: unknown) => void;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(
	undefined,
);

const WS_URL = import.meta.env.VITE_WS_URL || "http://localhost:3001";

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
	const [isConnected, setIsConnected] = useState(false);
	const [userCount, setUserCount] = useState(0);
	const socketRef = useRef<Socket | null>(null);
	const debouncedUpdateRef = useRef<((count: number) => void) | null>(null);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		// Create debounced update function
		debouncedUpdateRef.current = debounce((count: number) => {
			setUserCount(count);
		}, 300);

		const socket = io(WS_URL, {
			transports: ["websocket", "polling"],
			autoConnect: true,
			reconnection: true,
			reconnectionAttempts: 5,
			reconnectionDelay: 1000,
		});

		socketRef.current = socket;

		socket.on("connect", () => {
			setIsConnected(true);
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
	}, []);

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
