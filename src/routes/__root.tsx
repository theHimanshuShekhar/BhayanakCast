import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
} from "@tanstack/react-router";
import Header from "../components/Header";
import { AuthProviders } from "../integrations/better-auth/providers";
import PostHogProvider from "../integrations/posthog/provider";
import TanStackQueryProvider from "../integrations/tanstack-query/root-provider";
import { PeerJSProvider } from "../lib/peerjs-context";
import { ThemeProvider } from "../lib/theme-context";
import { WebSocketProvider } from "../lib/websocket-context";
import appCss from "../styles.css?url";

interface MyRouterContext {
	queryClient: QueryClient;
}

const THEME_INIT_SCRIPT = `(function(){try{var root=document.documentElement;var theme=localStorage.getItem('bhayanakcast-theme')||'purple-blue';root.setAttribute('data-theme',theme);}catch(e){}})();`;

export const Route = createRootRouteWithContext<MyRouterContext>()({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "BhayanakCast",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
		],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				{/* biome-ignore lint: Theme init script is static and safe */}
				<script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
				<HeadContent />
			</head>
			<body
				className="flex h-screen w-screen overflow-hidden font-sans antialiased"
				suppressHydrationWarning
			>
				<ThemeProvider>
					<TanStackQueryProvider>
						<AuthProviders>
							<PostHogProvider>
								<WebSocketProvider>
									<PeerJSProvider>
										<Header />
										<div className="flex-1 overflow-auto bg-depth-0">
											{children}
										</div>
									</PeerJSProvider>
								</WebSocketProvider>
							</PostHogProvider>
						</AuthProviders>
					</TanStackQueryProvider>
				</ThemeProvider>
				<Scripts />
			</body>
		</html>
	);
}
