import { createFileRoute } from "@tanstack/react-router";
import { publicRoute } from "#/lib/auth-guard";

// Public route - accessible to all users including logged out
export const Route = createFileRoute("/")({
	component: App,
	beforeLoad: publicRoute,
});

function App() {
	return (
		<div className="h-full w-full bg-depth-0 px-4 py-12">
			<div className="mx-auto max-w-4xl">
				<h1 className="text-4xl font-bold text-text-primary">
					Welcome to BhayanakCast
				</h1>
			</div>
		</div>
	);
}
