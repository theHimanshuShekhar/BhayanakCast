import { useAuthenticate } from "@daveyplate/better-auth-ui";

interface AuthGuardProps {
	children: React.ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
	useAuthenticate();

	return <>{children}</>;
}
