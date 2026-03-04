import { useEffect, useState } from "react";

/**
 * ClientOnly component - only renders children on the client side
 * Use this to prevent hydration mismatches for components that depend on client-only APIs
 */
export function ClientOnly({ children }: { children: React.ReactNode }) {
	const [isClient, setIsClient] = useState(false);

	useEffect(() => {
		setIsClient(true);
	}, []);

	if (!isClient) {
		return null;
	}

	return <>{children}</>;
}
