import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/past/$roomId")({
  component: PastStreamPage,
});

function PastStreamPage() {
  const { roomId } = Route.useParams();
  return <h1>Past stream {roomId}</h1>;
}
