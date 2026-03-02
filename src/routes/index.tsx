import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: App });

function App() {
	return (
		<div className="h-full w-full bg-depth-0 px-4 py-12">
			<div className="mx-auto max-w-4xl">
				<h1 className="text-4xl font-bold text-text-primary">
					Welcome to BhayanakCast
				</h1>
				<p className="mt-4 text-text-secondary">
					Your dark-themed podcast platform
				</p>
			</div>
		</div>
	);
}
