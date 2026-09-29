import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef } from "react";
import { Icon } from "~/components/icons";
import { DeviceCheck, useDeviceState } from "~/components/room/lobby";
import { SignInButton } from "~/components/sign-in-button";
import { Btn, MonoCaps } from "~/components/ui";
import { useCurrentSession } from "~/lib/current-user";
import { type InvitedRoom, invitePath } from "~/lib/invites";
import { inviteQuery } from "~/lib/invites.queries";
import { type KnockState, useKnock } from "~/lib/knock-live";
import { getLocalMedia } from "~/lib/local-media";
import { KNOCK_EXPIRY_MS } from "~/lib/realtime";
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
        {/* Back to this invite link once signed in, not home. */}
        <SignInButton callbackURL={invitePath(inviteToken)} />
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

/** Where the knock stands, in words. */
const KNOCK_TEXT: Record<Exclude<KnockState["status"], "invalid" | "error">, string> = {
  idle: "this room is private. knock, and the host or a mod can let you in.",
  knocking: "knocked. waiting for the host to let you in…",
  waiting: "knocked. waiting for the host to let you in…",
  waiting_for_host:
    "waiting for the host. nobody who can let you in is here yet; they'll see your knock when they arrive.",
  approved: "you're in. joining…",
  room_full: "you're approved, but the room is full. joining as soon as a spot frees up…",
  denied: "the host declined your request.",
  expired: `nobody answered within ${KNOCK_EXPIRY_MS / 60_000} minutes. you can knock again.`,
  elsewhere: "you're knocking from another tab or device now. knock here to wait here instead.",
};

/**
 * Knock, and wait for the host or a mod with the lobby's device check (the waiting screen), then
 * go straight in once admitted with the mic and camera as set up here. Leaving it undecided
 * withdraws the knock (`useKnock`) and releases the mic and camera.
 */
function KnockScreen({ invite, inviteToken }: { invite: InvitedRoom; inviteToken: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useCurrentSession();
  const { state, knock } = useKnock(inviteToken);
  const { starting } = useDeviceState();
  // Approved into a full room too: the room page waits for a spot.
  const admittedTo =
    state.status === "approved" || state.status === "room_full" ? state.roomId : null;
  const goingIn = useRef(false);
  useEffect(() => {
    // Once a device that's starting is on or off, so it's entered as it is.
    if (!admittedTo || starting) return;
    // Straight in, past the pre-join lobby, and the room is visible to this user now, so
    // room reads made before are stale.
    goingIn.current = true;
    markInRoom(admittedTo, true);
    void queryClient.invalidateQueries({ queryKey: roomKeys.all });
    void navigate({ to: "/room/$roomId", params: { roomId: admittedTo } });
  }, [admittedTo, starting, navigate, queryClient]);
  // The room page takes the mic and camera over; otherwise they go with this screen, or with
  // its device check once the link turns out invalid.
  const invalid = state.status === "invalid";
  useEffect(() => {
    if (invalid) getLocalMedia().release();
  }, [invalid]);
  useEffect(
    () => () => {
      if (!goingIn.current) getLocalMedia().release();
    },
    [],
  );

  if (state.status === "invalid") return <InvalidInvite />;
  const canKnock =
    state.status === "idle" ||
    state.status === "error" ||
    state.status === "expired" ||
    state.status === "elsewhere";
  return (
    <DeviceCheck
      kicker="private room"
      roomName={invite.name}
      me={user?.username ?? ""}
      meImage={user?.image ?? null}
      info={
        <p role="status" className="m-0 text-[12px] text-fg-muted">
          {state.status === "error" ? state.message : KNOCK_TEXT[state.status]}
        </p>
      }
    >
      <div className="flex gap-2 mt-auto">
        <Btn onClick={() => navigate({ to: "/" })}>back</Btn>
        {canKnock && (
          <Btn variant="primary" className="flex-1" onClick={knock}>
            <Icon.Users size={13} /> {state.status === "expired" ? "knock again" : "knock"}
          </Btn>
        )}
      </div>
    </DeviceCheck>
  );
}
