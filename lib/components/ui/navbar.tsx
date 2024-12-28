import { Link } from "@tanstack/react-router";
import { Button } from "~/lib/components/ui/button";
import type { User } from "~/lib/server/db/schema";

function Navbar({ user }: { user: User | null }) {
  console.log(user);

  return (
    <div className="flex justify-between">
      <h1 className="cursor-pointer select-none text-4xl font-bold">BhayanakCast</h1>
      {user ? (
        <div className="text-center align-middle text-xl font-semibold">{user.name}</div>
      ) : (
        <Button asChild className="w-fit bg-gray-600">
          <Link to="/signin">Login</Link>
        </Button>
      )}
    </div>
  );
}

export default Navbar;
