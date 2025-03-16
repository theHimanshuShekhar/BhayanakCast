import { createFileRoute } from "@tanstack/react-router";
import { SearchBar } from "~/lib/components/Search";

export const Route = createFileRoute("/")({
  component: Home,
  loader: ({ context }) => {
    return { user: context.user };
  },
});

function Home() {
  return (
    <>
      <SearchBar />
    </>
  );
}
