import { UserButton } from "@daveyplate/better-auth-ui";
import { Link } from "@tanstack/react-router";

export default function Header() {
	return (
		<header className="border-b border-border-subtle bg-depth-2 px-4 py-3 shrink-0">
			<nav className="mx-auto flex max-w-7xl items-center justify-between">
				<Link to="/" className="text-xl font-bold text-text-primary">
					BhayanakCast
				</Link>
				<UserButton size={"sm"} />
			</nav>
		</header>
	);
}
