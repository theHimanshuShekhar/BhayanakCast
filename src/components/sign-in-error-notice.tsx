// Shown on home when Discord sign-in comes back with an error (Better Auth's
// `?error=…&error_description=…` redirect). A banned user sees why and for how long.
import { BANNED_USER_ERROR, type SignInErrorSearch } from "~/lib/ban";
import { HomeNotice } from "./home-notice";
import { Icon } from "./icons";
import { SignInButton } from "./sign-in-button";

export const SignInErrorNotice = ({
  search,
  onDismiss,
}: {
  search: SignInErrorSearch;
  onDismiss: () => void;
}) => {
  if (!search.error) return null;
  const banned = search.error === BANNED_USER_ERROR;
  return (
    <HomeNotice
      icon={Icon.Lock}
      title={banned ? "Your account is banned" : "Sign-in with Discord didn't complete"}
      detail={
        banned
          ? search.error_description
          : "Discord didn't send you back signed in. Maybe the consent screen was cancelled."
      }
      action={banned ? undefined : <SignInButton variant="retry" />}
      onDismiss={onDismiss}
    />
  );
};
