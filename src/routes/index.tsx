import { QueryClientProvider } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { NavBar } from "~/lib/components/NavBar";

export const Route = createFileRoute("/")({
  component: Home,
  loader: ({ context }) => {
    return { user: context.user };
  },
});

function Home() {
  const { queryClient } = Route.useRouteContext();
  const { user } = Route.useLoaderData();

  return (
    <div className="flex flex-col gap-4 p-6">
      <QueryClientProvider client={queryClient}>
        <NavBar user={user} />
      </QueryClientProvider>
    </div>
  );
}
