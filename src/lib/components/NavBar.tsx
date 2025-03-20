import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import authClient from "../auth-client";
import { SignInButton } from "./SignInButton";
import ThemeToggle from "./ThemeToggle";
import { Button } from "./ui/button";
import UserDisplay from "./UserDisplay";

interface NavBarProps {
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    createdAt: Date;
    updatedAt: Date;
    image?: string | null;
  } | null;
}

export function NavBar({ user }: NavBarProps) {
  const queryClient = useQueryClient();
  const router = useRouter();

  return (
    <nav className="flex justify-between items-center gap-2">
      <Link to={"/"}>
        <h1 className="text-4xl font-bold cursor-pointer">BhayanakCast</h1>
      </Link>
      <div className="flex gap-2 items-center">
        <ThemeToggle />
        {user ? (
          <div className="flex justify-center align-middle gap-2 items-center">
            <UserDisplay id={user.id} name={user.name} image={user.image ?? null} />
            <Button
              onClick={async () => {
                await authClient.signOut();
                await queryClient.invalidateQueries({ queryKey: ["user"] });
                await router.invalidate();
              }}
              type="button"
              className="w-fit"
              variant="destructive"
              size="sm"
            >
              Sign out
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <SignInButton
              provider="discord"
              label="Discord"
              className="bg-[#5865F2] w-fit hover:bg-[#5865F2]/80"
            />
          </div>
        )}
      </div>
    </nav>
  );
}
