import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import authClient from "../auth-client";
import { SignInButton } from "./SignInButton";
import ThemeToggle from "./ThemeToggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
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

interface NavBarUserProps {
  user: NonNullable<NavBarProps["user"]>;
  queryClient: ReturnType<typeof useQueryClient>;
  router: ReturnType<typeof useRouter>;
}

export function NavBar({ user }: NavBarProps) {
  const queryClient = useQueryClient();
  const router = useRouter();
  return (
    <nav className="h-[30px] flex justify-between items-center gap-2">
      <Link to={"/"} className="flex gap-1 items-center">
        {/* <Avatar className="border-2 dark:border-gray-100 border-gray-900 shadow-xl h-12 w-12">
          <AvatarImage src="/public/gman.png" alt="BCLogo" />
          <AvatarFallback className="bg-gray-500 text-white">BC</AvatarFallback>
        </Avatar> */}
        <h1 className="text-2xl md:text-4xl font-bold cursor-pointer">BhayanakCast</h1>
      </Link>
      <div className="flex gap-2 items-center">
        <ThemeToggle />
        {user ? (
          <NavBarUser user={user} queryClient={queryClient} router={router} />
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

function NavBarUser({ user, queryClient, router }: NavBarUserProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <div className="flex justify-center align-middle gap-2 items-center">
          <UserDisplay id={user.id} name={user.name} image={user.image ?? null} />
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Profile</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            await authClient.signOut();
            await queryClient.invalidateQueries({ queryKey: ["user"] });
            await router.invalidate();
          }}
        >
          Signout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
