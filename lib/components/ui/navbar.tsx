import { Link } from "@tanstack/react-router";
import { Button } from "~/lib/components/ui/button";
import type { User } from "~/lib/server/db/schema";

interface NavbarProps {
  loggedInUser?: User | null; // The user can be logged in or null/undefined
}

function Navbar({ loggedInUser }: NavbarProps) {
  console.log(loggedInUser);

  return (
    <div className="flex justify-between border border-purple-700 p-4">
      <h1 className="cursor-pointer select-none text-4xl font-bold">Bhayanak</h1>
      {loggedInUser ? (
        <div className="text-center align-middle text-xl font-semibold">
          {loggedInUser.name}
        </div>
      ) : (
        <Button type="button" asChild className="w-fit bg-gray-600" size="lg">
          <Link to="/signin">Login</Link>
        </Button>
      )}
    </div>
  );
}

export default Navbar;
