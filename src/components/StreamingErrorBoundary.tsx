/**
 * StreamingErrorBoundary
 *
 * React error boundary for the streaming section of a room.
 * Catches render errors thrown by PeerJS/streaming components and
 * shows a recoverable fallback UI.
 *
 * @module components/StreamingErrorBoundary
 */

import { Component, type ReactNode, type ErrorInfo } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
	children: ReactNode;
	onReset?: () => void;
}

interface State {
	hasError: boolean;
	errorMessage: string | null;
}

export class StreamingErrorBoundary extends Component<Props, State> {
	constructor(props: Props) {
		super(props);
		this.state = { hasError: false, errorMessage: null };
	}

	static getDerivedStateFromError(error: Error): State {
		return {
			hasError: true,
			errorMessage: error.message || "An unexpected streaming error occurred.",
		};
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
		console.error("[StreamingErrorBoundary] Caught error:", error, errorInfo);
	}

	private handleRetry = () => {
		this.setState({ hasError: false, errorMessage: null });
		this.props.onReset?.();
	};

	render() {
		if (this.state.hasError) {
			return (
				<div className="bg-depth-2 rounded-xl aspect-video flex flex-col items-center justify-center border-2 border-dashed border-danger/50 p-6">
					<AlertTriangle className="h-12 w-12 text-danger mb-4" />
					<p className="text-text-primary text-lg font-semibold mb-2">
						Streaming Error
					</p>
					<p className="text-text-secondary text-sm text-center mb-6 max-w-xs">
						{this.state.errorMessage}
					</p>
					<button
						type="button"
						onClick={this.handleRetry}
						className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-xl font-medium transition-colors"
					>
						Retry
					</button>
				</div>
			);
		}

		return this.props.children;
	}
}
