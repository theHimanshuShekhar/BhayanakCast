/**
 * PeerJS Context
 *
 * Singleton context for PeerJS peer instance management.
 * Prevents duplicate Peer instances when hook is used across
 * multiple components or re-renders.
 *
 * @module lib/peerjs-context
 */

import Peer from "peerjs";
import { createContext, useCallback, useContext, useRef } from "react";
import { getRTCConfiguration } from "#/lib/webrtc-config";

interface PeerJSContextType {
	/** Get the current peer instance (null if not initialized) */
	getPeer: () => Peer | null;
	/** Get or create a peer with the given ID. Returns existing peer if already initialized. */
	getOrCreatePeer: (peerId: string) => Peer;
	/** Destroy the current peer and clear the ref */
	destroyPeer: () => void;
}

const PeerJSContext = createContext<PeerJSContextType | null>(null);

export function PeerJSProvider({ children }: { children: React.ReactNode }) {
	const peerRef = useRef<Peer | null>(null);

	const getOrCreatePeer = useCallback((peerId: string): Peer => {
		// Reuse existing peer if still alive AND has matching ID
		if (peerRef.current && !peerRef.current.destroyed) {
			if (peerRef.current.id === peerId) {
				console.log(
					"[PeerJS] Reusing existing peer instance:",
					peerRef.current.id,
				);
				return peerRef.current;
			}
			// ID mismatch — destroy old peer before creating new one
			console.log(
				"[PeerJS] ID mismatch, destroying old peer:",
				peerRef.current.id,
			);
			peerRef.current.destroy();
			peerRef.current = null;
		}

		const peer = new Peer(peerId, {
			debug: 2,
			config: getRTCConfiguration(),
		});
		peerRef.current = peer;
		console.log("[PeerJS] Created new peer instance:", peerId);
		return peer;
	}, []);

	const destroyPeer = useCallback(() => {
		if (peerRef.current) {
			console.log("[PeerJS] Destroying peer instance:", peerRef.current.id);
			peerRef.current.destroy();
			peerRef.current = null;
		}
	}, []);

	const getPeer = useCallback(() => peerRef.current, []);

	return (
		<PeerJSContext.Provider value={{ getPeer, getOrCreatePeer, destroyPeer }}>
			{children}
		</PeerJSContext.Provider>
	);
}

export function usePeerJSContext(): PeerJSContextType {
	const context = useContext(PeerJSContext);
	if (!context) {
		throw new Error("usePeerJSContext must be used within PeerJSProvider");
	}
	return context;
}
