import { Link } from "@tanstack/react-router";
import { Button } from "~/lib/components/ui/button";
import type { User } from "~/lib/server/db/schema";
import { Avatar, AvatarImage } from "./avatar";

function Navbar({ user }: { user: User | null }) {
  return (
    <div className="flex shrink items-center justify-between">
      <a href={"/"} className="cursor-pointer select-none text-2xl font-bold md:text-4xl">
        BhayanakCast
      </a>
      {user ? (
        <div className="flex items-center gap-2">
          <Avatar className="border-2 border-purple-500">
            <AvatarImage src={user?.avatar_url ?? "https://github.com/shadcn.png"} />
          </Avatar>
          <div className="text-center text-lg font-bold md:text-2xl">{user.name}</div>
        </div>
      ) : (
        <form
          method="GET"
          className="flex flex-col gap-2 rounded-lg bg-purple-800 text-white"
        >
          <Button formAction="/api/auth/discord" type="submit" size="lg">
            Sign in
          </Button>
        </form>
      )}
    </div>
  );
}

export default Navbar;
