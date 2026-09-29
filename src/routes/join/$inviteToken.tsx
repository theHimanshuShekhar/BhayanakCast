import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { Icon } from "~/components/icons";
import { SignInButton } from "~/components/sign-in-button";
import { Btn, MonoCaps } from "~/components/ui";
import { useCurrentSession } from "~/lib/current-user";
import type { InvitedRoom } from "~/lib/invites";
import { inviteQuery } from "~/lib/invites.queries";
import { useKnock } from "~/lib/knock-live";
import { markInRoom } from "~/lib/room-live";
import { roomKeys } from "~/lib/rooms.queries";

// A private room's invite link (ADR 16): see the room's name and knock to be let in.
export const Route = createFileRoute("/join/$inviteToken")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(inviteQuery(params.inviteToken)),
  component: JoinRoute,
});

function JoinRoute() {
  const { inviteToken } = Route.useParams();
  const { user } = useCurrentSession();
  const { data: invite } = useSuspenseQuery(inviteQuery(inviteToken));
  if (!invite) return <InvalidInvite />;
  if (!user) {
    return (
      <KnockCard name={invite.name}>
        <p className="m-0 text-[12px] text-fg-muted">sign in to knock on this private room.</p>
        <SignInButton />
      </KnockCard>
    );
  }
  // key starts over (not knocking yet) if the signed-in user changes
  return <KnockScreen key={user.id} invite={invite} inviteToken={inviteToken} />;
}

function InvalidInvite() {
  return (
    <div className="px-10 py-20 text-center" role="alert">
      <h1 className="m-0 mb-2 text-lg">this invite link is no longer valid</h1>
      <p className="m-0 mb-4 text-muted text-[12.5px]">ask the host for a new one.</p>
      <Link to="/" className="text-primary">
        back to rooms
      </Link>
    </div>
  );
}

function KnockCard({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="h-full overflow-auto grid place-items-center px-4 py-8 max-sm:py-4 bg-bg">
      <section
        aria-labelledby="knock-title"
        className="w-[min(420px,100%)] flex flex-col gap-4 p-5 max-sm:p-3.5 bg-surface border border-border rounded-[var(--radius-lg)] shadow-pop"
      >
        <div className="flex flex-col gap-1.5">
          <MonoCaps>private room</MonoCaps>
          <h1 id="knock-title" className="m-0 text-lg font-semibold break-words">
            {name}
          </h1>
        </div>
        {children}
      </section>
    </div>
  );
}

/** Knock, wait for the host or a mod, and go straight in once admitted. */
function KnockScreen({ invite, inviteToken }: { invite: InvitedRoom; inviteToken: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { state, knock } = useKnock(inviteToken);
  const admittedTo = state.status === "approved" ? state.roomId : null;
  useEffect(() => {
    if (!admittedTo) return;
    // Straight in, past the pre-join lobby (mic and camera off), and the room is visible to
    // this user now, so room reads made before are stale.
    markInRoom(admittedTo, true);
    void queryClient.invalidateQueries({ queryKey: roomKeys.all });
    void navigate({ to: "/room/$roomId", params: { roomId: admittedTo } });
  }, [admittedTo, navigate, queryClient]);

  if (state.status === "invalid") return <InvalidInvite />;
  const waiting = state.status === "knocking" || state.status === "waiting";
  return (
    <KnockCard name={invite.name}>
      <p role="status" className="m-0 text-[12px] text-fg-muted">
        {state.status === "idle" &&
          "this room is private. knock, and the host or a mod can let you in."}
        {waiting && "knocked. waiting for the host to let you in…"}
        {state.status === "approved" && "you're in. joining…"}
        {state.status === "denied" && "the host declined your request."}
        {state.status === "error" && state.message}
      </p>
      <div className="flex gap-2">
        <Btn onClick={() => navigate({ to: "/" })}>back</Btn>
        {(state.status === "idle" || state.status === "error") && (
          <Btn variant="primary" className="flex-1" onClick={knock}>
            <Icon.Users size={13} /> knock
          </Btn>
        )}
      </div>
    </KnockCard>
  );
}
