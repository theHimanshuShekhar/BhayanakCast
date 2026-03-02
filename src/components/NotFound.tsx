import { Link } from "@tanstack/react-router";

export default function NotFound() {
	return (
		<div className="flex h-full w-full flex-col items-center justify-center bg-depth-0 px-4">
			<div className="text-center">
				<h1 className="text-6xl font-bold text-text-primary">404</h1>
				<p className="mt-4 text-xl text-text-secondary">Page not found</p>
				<p className="mt-2 text-text-tertiary">
					The page you're looking for doesn't exist.
				</p>
				<Link
					to="/"
					className="mt-8 inline-block px-6 py-3 text-sm font-medium text-text-primary bg-accent hover:bg-accent-hover rounded transition-colors"
				>
					Go back home
				</Link>
			</div>
		</div>
	);
}
