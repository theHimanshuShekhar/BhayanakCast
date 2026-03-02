import { AuthView } from "@daveyplate/better-auth-ui";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/$authView")({
	component: RouteComponent,
});

function RouteComponent() {
	const { authView } = Route.useParams();

	return (
		<main className="flex h-full w-full items-center justify-center bg-depth-0 p-4">
			<div className="w-full max-w-md">
				<AuthView pathname={authView} />
			</div>
		</main>
	);
}
