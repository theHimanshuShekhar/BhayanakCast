import type { ComponentProps } from "react";
import authClient from "~/lib/auth-client";
import { Button } from "~/lib/components/ui/button";
import { cn } from "~/lib/utils";

interface SignInButtonProps extends ComponentProps<typeof Button> {
  provider: "discord" | "google" | "github";
  label: string;
}

export function SignInButton({
  provider,
  label,
  className,
  ...props
}: SignInButtonProps) {
  return (
    <Button
      onClick={() =>
        authClient.signIn.social({
          provider,
          callbackURL: "/",
        })
      }
      type="button"
      variant="outline"
      size="lg"
      className={cn("text-white hover:text-white", className)}
      {...props}
    >
      Sign in with {label}
    </Button>
  );
}
