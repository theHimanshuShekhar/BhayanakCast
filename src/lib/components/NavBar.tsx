import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import authClient from "../auth-client";
import { SignInButton } from "./SignInButton";
import ThemeToggle from "./ThemeToggle";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Button } from "./ui/button";

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
    <nav className="flex justify-between items-center p-2">
      <Link to={"/"}>
        <h1 className="text-4xl font-bold cursor-pointer">BhayanakCast</h1>
      </Link>
      <div className="flex gap-2 items-center">
        <ThemeToggle />
        {user ? (
          <div className="flex justify-center align-middle gap-2 items-center">
            <div className="cursor-pointer flex gap-2 items-center font-semibold dark:bg-purple-800 p-1 rounded-md">
              <Avatar>
                <AvatarImage src="https://github.com/shadcn.png" />
                <AvatarFallback>{user.name.at(0)}</AvatarFallback>
              </Avatar>
              <div>{user.name}</div>
            </div>
            <Button
              onClick={async () => {
                await authClient.signOut();
                await queryClient.invalidateQueries({ queryKey: ["user"] });
                await router.invalidate();
              }}
              type="button"
              className="w-fit"
              variant="destructive"
              size="lg"
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
