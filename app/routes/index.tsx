import { createFileRoute } from "@tanstack/react-router";
import Navbar from "../../lib/components/ui/navbar";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const { user } = Route.useRouteContext();
  return (
    <>
      <Navbar loggedInUser={user} />
      <div className="flex flex-col gap-4 p-6">
        <div className="text-2xl">Room List</div>
      </div>
    </>
  );
}
