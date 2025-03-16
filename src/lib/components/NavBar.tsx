import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import authClient from "../auth-client";
import { SignInButton } from "./SignInButton";
import ThemeToggle from "./ThemeToggle";
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
      <h1 className="text-4xl font-bold">BhayanakCast</h1>
      <div className="flex gap-4 items-center">
        <ThemeToggle />
        {user ? (
          <div className="flex justify-center align-middle gap-4">
            <div className="flex items-center font-semibold">{user.name}</div>
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
