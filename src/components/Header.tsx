import { UserButton } from "@daveyplate/better-auth-ui";
import { Link } from "@tanstack/react-router";
import { User } from "lucide-react";
import { authClient } from "#/lib/auth-client";

export default function Header() {
	const { data: session } = authClient.useSession();

	return (
		<header className="border-b border-border-subtle bg-depth-2 px-4 py-3 shrink-0">
			<nav className="mx-auto flex max-w-7xl items-center justify-between">
				<Link to="/" className="text-xl font-bold text-text-primary">
					BhayanakCast
				</Link>
				{session?.user?.id ? (
					<UserButton
						size="sm"
						disableDefaultLinks
						additionalLinks={[
							{
								label: "Profile",
								href: `/profile/${session.user.id}`,
								icon: <User className="h-4 w-4" />,
							},
						]}
					/>
				) : (
					<Link
						to="/auth/$authView"
						params={{ authView: "sign-in" }}
						className="text-text-primary hover:text-accent transition-colors"
					>
						Sign In
					</Link>
				)}
			</nav>
		</header>
	);
}
