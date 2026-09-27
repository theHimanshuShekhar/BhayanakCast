import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { Icon, type IconComponent } from "~/components/icons";
import { PastCard } from "~/components/room-cards";
import { SectionHead } from "~/components/section-head";
import { Avatar, Btn } from "~/components/ui";
import { useAppActions } from "~/lib/app-actions";
import { useCurrentSession } from "~/lib/current-user";
import { toggleFavoriteFn } from "~/lib/favorites.functions";
import { favoriteKeys, isFavoriteQuery } from "~/lib/favorites.queries";
import { avatarFor, formatCotime } from "~/lib/format";
// TODO(#17): recent streams still come from mock past rooms.
import { PAST_ROOMS } from "~/lib/mock-data";
import { formatJoined, type Profile } from "~/lib/profiles";
import { profileQuery } from "~/lib/profiles.queries";

export const Route = createFileRoute("/profile/$userId")({
  loader: async ({ context, params }) => {
    const profile = await context.queryClient.ensureQueryData(profileQuery(params.userId));
    if (!profile) throw notFound();
    // Seed the favorite badge for first paint (signed in, on someone else's profile).
    const { user } = context.session;
    if (user && user.id !== params.userId) {
      await context.queryClient.ensureQueryData(isFavoriteQuery(params.userId));
    }
  },
  notFoundComponent: ProfileNotFound,
  component: ProfileRoute,
});

function ProfileNotFound() {
  return (
    <div className="px-10 py-20 text-center">
      <h1 className="m-0 mb-2 text-lg">user not found</h1>
      <p className="m-0 mb-4 text-muted text-[12.5px]">no profile with this id</p>
      <Link to="/" className="text-primary">
        back
      </Link>
    </div>
  );
}

function ProfileRoute() {
  const { userId } = Route.useParams();
  const { data: profile } = useSuspenseQuery(profileQuery(userId));
  // The account can disappear after load (a later refetch).
  if (!profile) return <ProfileNotFound />;
  return <ProfilePage key={profile.id} profile={profile} />;
}

const STAT_TONE_CARD = {
  "": "border-border",
  accent:
    "border-[color-mix(in_oklch,var(--color-primary)_50%,var(--color-border))] bg-[linear-gradient(135deg,var(--color-primary-soft),var(--color-surface)_60%)]",
  live: "border-[color-mix(in_oklch,var(--color-live)_45%,var(--color-border))]",
};
const STAT_TONE_ICO = {
  "": "bg-surface-2 text-fg-muted",
  accent: "bg-primary text-primary-ink shadow-[0_0_10px_var(--color-primary-glow)]",
  live: "bg-[color-mix(in_oklch,var(--color-live)_25%,var(--color-surface-2))] text-live-ink",
};

const StatCard = ({
  icon: I,
  label,
  value,
  unit,
  tone = "",
}: {
  icon: IconComponent;
  label: string;
  value: string | number;
  unit?: string;
  tone?: keyof typeof STAT_TONE_CARD;
}) => (
  <div
    className={`bg-surface border rounded-[var(--radius)] p-[14px_16px_18px] flex flex-col gap-2.5 transition-[border-color,transform] duration-[120ms] hover:border-border-strong hover:-translate-y-px ${STAT_TONE_CARD[tone]}`}
  >
    <div className="flex items-center gap-2">
      <span
        className={`w-[22px] h-[22px] grid place-items-center rounded-md ${STAT_TONE_ICO[tone]}`}
      >
        <I size={12} />
      </span>
      <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-semibold">
        {label}
      </span>
    </div>
    <div className="text-[32px] font-extrabold tracking-[-0.02em] text-fg leading-none">
      {value}
      {unit && <span className="text-sm font-medium text-muted ml-0.5">{unit}</span>}
    </div>
  </div>
);

/**
 * Whether the signed-in caller has favorited `userId`, and a toggle that flips it
 * optimistically (rolled back if the server refuses). Off for visitors and yourself.
 */
function useFavorite(userId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const queryKey = favoriteKeys.detail(userId);
  const { data: isFavorite = false } = useQuery({ ...isFavoriteQuery(userId), enabled });
  const mutation = useMutation({
    mutationFn: (favorite: boolean) => toggleFavoriteFn({ data: { userId, favorite } }),
    onMutate: async (favorite) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<boolean>(queryKey);
      queryClient.setQueryData(queryKey, favorite);
      return { previous };
    },
    onError: (_error, _favorite, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
  return { isFavorite, toggle: () => mutation.mutate(!isFavorite) };
}

function ProfilePage({ profile }: { profile: Profile }) {
  const userId = profile.id;
  const navigate = useNavigate();
  const { openSettings } = useAppActions();
  const { user } = useCurrentSession();

  const { username } = profile;
  const isSelf = user?.id === profile.id;
  const canFavorite = user !== null && !isSelf;
  const { isFavorite, toggle: toggleFavorite } = useFavorite(userId, canFavorite);

  const { stats, coUsers } = profile;
  const max = coUsers[0]?.secondsTogether || 1;
  const av = avatarFor(username);
  const recent = PAST_ROOMS.filter((r) => r.streamer === username || r.members.includes(username));

  return (
    <div className="overflow-auto min-h-0 h-full">
      <div className="relative h-[120px] sm:h-[180px] overflow-hidden border-b border-border-subtle">
        <div
          className="absolute inset-0"
          style={{
            background: `
            radial-gradient(60% 80% at 20% 20%, color-mix(in oklch, ${av.c1} 40%, transparent), transparent 60%),
            radial-gradient(50% 70% at 85% 80%, color-mix(in oklch, ${av.c2} 35%, transparent), transparent 60%),
            linear-gradient(135deg, var(--color-canvas), var(--color-surface-2))
          `,
          }}
        />
        <div className="absolute inset-0 bg-[linear-gradient(oklch(1_0_0/0.04)_1px,transparent_1px),linear-gradient(90deg,oklch(1_0_0/0.04)_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:linear-gradient(180deg,oklch(0_0_0/0.6),transparent_85%)]" />
      </div>

      <div className="px-4 sm:px-8 pb-12 max-w-[1100px] mx-auto">
        <div className="relative z-[1] flex flex-wrap items-start gap-x-6 gap-y-3 pb-6 border-b border-border-subtle">
          <div className="relative -mt-12 flex-shrink-0 p-1.5 bg-canvas border border-border-strong rounded-[20px] shadow-pop">
            <Avatar name={username} size="xl" ring />
            {isSelf && (
              <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[9px] font-bold tracking-[0.12em] px-1.5 py-0.5 rounded-md bg-primary text-primary-ink shadow-[0_0_12px_var(--color-primary-glow)]">
                YOU
              </span>
            )}
          </div>
          <div className="flex-1 min-w-[180px] pt-4 max-sm:pt-2">
            <div className="flex flex-wrap items-center gap-2.5 mb-2">
              <h1 className="m-0 text-[22px] sm:text-[28px] font-extrabold tracking-[-0.02em] text-fg break-all">
                {username}
              </h1>
              {canFavorite && isFavorite && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-[3px] rounded-full bg-[color-mix(in_oklch,var(--color-primary)_18%,transparent)] border border-[color-mix(in_oklch,var(--color-primary)_40%,transparent)] text-primary text-[10px] tracking-[0.08em] uppercase font-semibold">
                  <Icon.Sparkle size={10} /> favorite
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="inline-flex items-baseline gap-1.5">
                <span className="text-[10px] tracking-[0.12em] uppercase text-subtle font-medium">
                  discord
                </span>
                <span className="text-fg-muted font-medium">{profile.displayName}</span>
              </span>
              <span className="w-[3px] h-[3px] rounded-full bg-subtle" />
              <span className="inline-flex items-baseline gap-1.5">
                <span className="text-[10px] tracking-[0.12em] uppercase text-subtle font-medium">
                  joined
                </span>
                <span className="text-fg-muted font-medium">{formatJoined(profile.joinedAt)}</span>
              </span>
            </div>
          </div>
          <div className="pt-4 flex-shrink-0 max-sm:pt-0 max-sm:w-full max-sm:[&>button]:w-full">
            {isSelf ? (
              <Btn onClick={openSettings}>
                <Icon.Gear size={14} /> edit profile
              </Btn>
            ) : canFavorite ? (
              <Btn
                variant={isFavorite ? "danger" : "primary"}
                onClick={toggleFavorite}
                aria-pressed={isFavorite}
              >
                <Icon.Sparkle size={14} />
                {isFavorite ? "unfavorite" : "favorite"}
              </Btn>
            ) : null}
          </div>
        </div>

        <section className="mt-8">
          <SectionHead title="stats" sub="lifetime" />
          <div className="grid grid-cols-2 min-[720px]:grid-cols-3 min-[1000px]:grid-cols-5 gap-3">
            <StatCard
              icon={Icon.Broadcast}
              label="hours streamed"
              value={stats.hoursStreamed.toFixed(1)}
              unit="h"
              tone="accent"
            />
            <StatCard
              icon={Icon.Eye}
              label="hours watched"
              value={stats.hoursWatched.toFixed(1)}
              unit="h"
            />
            <StatCard icon={Icon.Plus} label="rooms hosted" value={stats.roomsHosted} />
            <StatCard icon={Icon.Users} label="rooms joined" value={stats.roomsJoined} />
            <StatCard icon={Icon.Bolt} label="peak viewers" value={stats.peakViewers} tone="live" />
          </div>
        </section>

        <section className="mt-8">
          <SectionHead
            title="recent streams"
            sub={recent.length ? "hosted or joined · last 30 days" : "none yet"}
          />
          {recent.length === 0 ? (
            <div className="p-6 bg-surface border border-border rounded-[var(--radius)] text-center text-subtle text-[11.5px]">
              no streams in the last 30 days
            </div>
          ) : (
            <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(230px,100%),1fr))]">
              {recent.map((r) => (
                <PastCard
                  key={r.id}
                  room={r}
                  onOpen={(room) => navigate({ to: "/past/$roomId", params: { roomId: room.id } })}
                />
              ))}
            </div>
          )}
        </section>

        <section className="mt-8">
          <SectionHead title="top co-users" sub="by time together" dot="success" />
          {coUsers.length === 0 ? (
            <div className="p-6 bg-surface border border-border rounded-[var(--radius)] text-center text-subtle text-[11.5px]">
              no shared time yet
            </div>
          ) : (
            <div className="flex flex-col bg-surface border border-border rounded-[var(--radius)] overflow-hidden">
              {coUsers.map((co, i) => (
                <Link
                  key={co.id}
                  to="/profile/$userId"
                  params={{ userId: co.id }}
                  className="group flex items-center gap-3 sm:gap-3.5 px-3 sm:px-4 py-3 border-b border-border-subtle text-left !text-fg transition-colors duration-[120ms] last:border-b-0 hover:bg-surface-2 hover:no-underline"
                >
                  <span className="w-[22px] flex-shrink-0 text-[11px] font-bold text-subtle tracking-[0.06em] group-hover:text-primary transition-colors">
                    #{i + 1}
                  </span>
                  <Avatar name={co.username} size="md" ring={i === 0} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-fg">{co.username}</div>
                    <div className="text-[10.5px] text-subtle tracking-[0.04em]">time together</div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 sm:min-w-[140px]">
                    <div className="text-[13px] font-bold text-primary tracking-[-0.01em]">
                      {formatCotime(co.secondsTogether)}
                    </div>
                    <div className="w-20 sm:w-[120px] h-1 rounded-full bg-surface-3 overflow-hidden">
                      <span
                        className="block h-full rounded-full shadow-[0_0_8px_var(--color-primary-glow)] bg-[linear-gradient(90deg,var(--color-primary),color-mix(in_oklch,var(--color-primary)_40%,var(--color-success)))]"
                        style={{ width: `${(co.secondsTogether / max) * 100}%` }}
                      />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
