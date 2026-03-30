# Mobile Responsive Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make BhayanakCast fully usable on mobile phones without breaking the desktop experience.

**Architecture:** Targeted Tailwind responsive prefixes (`md:` breakpoint = 768px) added to existing classes, following the pattern already used in `RoomList.tsx`. The sidebar becomes a top bar on mobile via a new `MobileTopBar` component rendered inside `Header.tsx`. The room page two-column layout stacks vertically. No desktop layout changes.

**Tech Stack:** React 19, Tailwind CSS 4, TanStack Router, Lucide React icons

---

## File Map

| File | Change |
|------|--------|
| `src/components/Header.tsx` | Add `hidden md:flex` to sidebar `<aside>`; add `MobileTopBar` function rendered `flex md:hidden` |
| `src/routes/__root.tsx` | Change body to `flex-col md:flex-row` so TopBar stacks above content on mobile |
| `src/routes/index.tsx` | Home page stats column: `flex-col xl:flex-row` container; unhide stats on mobile |
| `src/routes/room.$roomId.tsx` | Active room layout: stack columns on mobile; fix heights |
| `src/styles.css` | Add safe-area-inset CSS for notched phones |

---

## Task 1: Feature Branch

**Files:** none (git only)

- [ ] **Step 1: Create and switch to feature branch**

```bash
cd /home/hshekhar/Code/BhayanakCast
git checkout -b feat/mobile-responsive
```

Expected: `Switched to a new branch 'feat/mobile-responsive'`

---

## Task 2: Mobile Top Bar in Header

The existing `<aside>` sidebar has no mobile handling. We add `hidden md:flex` to hide it on mobile, then render a new `MobileTopBar` component (`flex md:hidden`) that shows a slim horizontal bar.

**Files:**
- Modify: `src/components/Header.tsx`

- [ ] **Step 1: Replace the default export and add MobileTopBar**

Open `src/components/Header.tsx`. The file currently exports `default function Sidebar()`. Replace the entire file with:

```tsx
import { UserButton } from "@daveyplate/better-auth-ui";
import { Link } from "@tanstack/react-router";
import { PanelLeft, User, Users } from "lucide-react";
import { useState } from "react";
import { authClient } from "#/lib/auth-client";
import { useWebSocket } from "#/lib/websocket-context";
import { ThemeSwitcher } from "./ThemeSwitcher";

function formatCompactNumber(num: number): string {
	if (num >= 1000000) {
		return `${(num / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
	}
	if (num >= 1000) {
		return `${(num / 1000).toFixed(1).replace(/\.0$/, "")}K`;
	}
	return num.toString();
}

function MobileTopBar() {
	const { data: session } = authClient.useSession();

	return (
		<header className="flex md:hidden items-center justify-between h-12 px-4 border-b border-border-subtle bg-depth-1 shrink-0">
			<Link
				to="/"
				className="flex items-center gap-2 text-accent font-bold hover:opacity-80 transition-opacity"
			>
				<div className="flex items-center justify-center w-7 h-7 rounded-lg bg-accent/10 text-accent font-bold text-sm">
					BC
				</div>
				<span className="text-sm">BhayanakCast</span>
			</Link>
			<div className="flex items-center gap-3">
				<ThemeSwitcher isExpanded={false} />
				{session?.user?.id ? (
					<UserButton
						size="icon"
						disableDefaultLinks
						additionalLinks={[
							{
								label: "Profile",
								href: `/profile/${session.user.id}`,
								icon: <User className="h-4 w-4" />,
							},
						]}
					/>
				) : (
					<Link
						to="/auth/$authView"
						params={{ authView: "sign-in" }}
						className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent hover:bg-accent-hover text-bg-primary font-bold transition-all"
						title="Sign In"
					>
						<User className="h-4 w-4" />
					</Link>
				)}
			</div>
		</header>
	);
}

function Sidebar() {
	const { data: session } = authClient.useSession();
	const { userCount, isConnected } = useWebSocket();
	const [isExpanded, setIsExpanded] = useState(false);

	const toggleSidebar = () => setIsExpanded(!isExpanded);

	const displayCount = isConnected ? formatCompactNumber(userCount) : "...";
	const displayCountWithLabel = isConnected
		? `${formatCompactNumber(userCount)} ${userCount === 1 ? "User" : "Users"}`
		: "...";

	return (
		<aside
			className={`hidden md:flex border-r border-border-subtle bg-depth-1 flex-col shrink-0 transition-all duration-300 ease-in-out ${
				isExpanded ? "w-60" : "w-16"
			}`}
		>
			{/* Section 1: Brand Logo */}
			<div className="p-4">
				<div className={isExpanded ? "" : "flex justify-center"}>
					{isExpanded ? (
						<Link
							to="/"
							className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-depth-2 transition-colors"
						>
							<div className="flex items-center justify-center w-10 h-10 rounded-xl bg-accent/10 text-accent font-bold text-xl">
								BC
							</div>
							<div className="flex flex-col">
								<span className="font-bold text-text-primary text-lg leading-tight">
									Bhayanak
								</span>
								<span className="font-bold text-accent text-lg leading-tight -mt-1">
									Cast
								</span>
							</div>
						</Link>
					) : (
						<div className="w-12 h-12">
							<Link
								to="/"
								className="flex items-center justify-center w-12 h-12 rounded-xl bg-accent/10 text-accent font-bold text-xl hover:bg-accent/20 transition-colors"
								title="BhayanakCast"
							>
								BC
							</Link>
						</div>
					)}
				</div>
			</div>

			{/* Section 2: Online Count and Theme Switcher */}
			<div className="px-4 pb-4 space-y-3">
				{/* Divider */}
				<div className="h-px bg-border-subtle" />

				{/* User Count Section */}
				<div className={isExpanded ? "" : "flex justify-center"}>
					{isExpanded ? (
						<div
							className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-depth-2 border border-border-subtle hover:border-border-default transition-colors cursor-pointer group"
							title={
								isConnected ? `${userCount} users online` : "Connecting..."
							}
						>
							<div className="relative shrink-0">
								<Users
									className={`h-5 w-5 ${
										isConnected ? "text-success" : "text-text-tertiary"
									}`}
								/>
								<span
									className={`absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-depth-2 ${
										isConnected ? "bg-success" : "bg-text-tertiary"
									}`}
								/>
							</div>
							<div className="flex flex-col min-w-0">
								<span className="text-sm font-semibold text-text-primary">
									{displayCountWithLabel}
								</span>
								<span className="text-xs text-text-tertiary truncate">
									online
								</span>
							</div>
						</div>
					) : (
						<div className="w-12 h-12">
							<div
								className="flex flex-col items-center justify-center w-12 h-12 rounded-xl bg-depth-2 border border-border-subtle hover:border-border-default transition-colors cursor-pointer group"
								title={
									isConnected ? `${userCount} users online` : "Connecting..."
								}
							>
								<div className="relative">
									<Users
										className={`h-5 w-5 ${
											isConnected ? "text-success" : "text-text-tertiary"
										}`}
									/>
									<span
										className={`absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full border-2 border-depth-2 ${
											isConnected ? "bg-success" : "bg-text-tertiary"
										}`}
									/>
								</div>
								<span className="text-[10px] font-semibold text-text-secondary mt-0.5">
									{displayCount}
								</span>
							</div>
						</div>
					)}
				</div>

				{/* Theme Switcher */}
				<div className={isExpanded ? "" : "flex justify-center"}>
					{isExpanded ? (
						<ThemeSwitcher isExpanded={isExpanded} />
					) : (
						<div className="w-12 h-12">
							<ThemeSwitcher isExpanded={isExpanded} />
						</div>
					)}
				</div>
			</div>

			{/* Spacer */}
			<div className="flex-1" />

			{/* Section 3: UserButton and Sidebar toggle */}
			<div className="p-4 space-y-3">
				{/* Divider */}
				<div className="h-px bg-border-subtle" />

				{/* Auth */}
				<div>
					{session?.user?.id ? (
						<div className={isExpanded ? "w-full" : "flex justify-center"}>
							{isExpanded ? (
								<div className="w-full flex justify-center">
									<UserButton
										size="sm"
										disableDefaultLinks
										additionalLinks={[
											{
												label: "Profile",
												href: `/profile/${session.user.id}`,
												icon: <User className="h-4 w-4" />,
											},
										]}
									/>
								</div>
							) : (
								<div className="w-12 h-12">
									<UserButton
										size="icon"
										disableDefaultLinks
										additionalLinks={[
											{
												label: "Profile",
												href: `/profile/${session.user.id}`,
												icon: <User className="h-4 w-4" />,
											},
										]}
									/>
								</div>
							)}
						</div>
					) : isExpanded ? (
						<Link
							to="/auth/$authView"
							params={{ authView: "sign-in" }}
							className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-bg-primary font-bold transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-accent/20"
						>
							<User className="h-4 w-4" />
							<span>Sign In</span>
						</Link>
					) : (
						<div className={isExpanded ? "" : "flex justify-center"}>
							<div className="w-12 h-12">
								<Link
									to="/auth/$authView"
									params={{ authView: "sign-in" }}
									className="flex items-center justify-center w-12 h-12 rounded-xl bg-accent hover:bg-accent-hover text-bg-primary font-bold transition-all hover:scale-[1.05] active:scale-[0.95] shadow-lg shadow-accent/20"
									title="Sign In"
								>
									<User className="h-5 w-5" />
								</Link>
							</div>
						</div>
					)}
				</div>

				{/* Toggle Button */}
				<div className={isExpanded ? "" : "flex justify-center"}>
					<button
						type="button"
						onClick={toggleSidebar}
						className={`flex items-center justify-center rounded-xl transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] focus:outline-none ${
							isExpanded
								? "w-full px-4 py-2.5 gap-2 hover:bg-depth-2 text-text-secondary hover:text-text-primary"
								: "w-12 h-12 hover:bg-depth-2 text-text-secondary hover:text-text-primary"
						}`}
						title={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
					>
						<PanelLeft
							className={`h-5 w-5 transition-transform duration-300 ${
								isExpanded ? "" : "rotate-180"
							}`}
						/>
						{isExpanded && (
							<span className="text-sm font-medium">Collapse</span>
						)}
					</button>
				</div>
			</div>
		</aside>
	);
}

export default function Header() {
	return (
		<>
			<MobileTopBar />
			<Sidebar />
		</>
	);
}
```

- [ ] **Step 2: Update root layout body to support top-bar-on-mobile**

In `src/routes/__root.tsx`, change the `<body>` className from:
```
"flex h-screen w-screen overflow-hidden font-sans antialiased"
```
to:
```
"flex flex-col md:flex-row h-screen w-screen overflow-hidden font-sans antialiased"
```

- [ ] **Step 3: Run lint**

```bash
cd /home/hshekhar/Code/BhayanakCast && pnpm check
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/components/Header.tsx src/routes/__root.tsx
git commit -m "feat: add mobile top bar, hide sidebar on small screens"
```

---

## Task 3: Home Page Stats on Mobile

The stats column is `hidden xl:block` — invisible on mobile. We make the container `flex-col xl:flex-row` so the stats appear below the room list on small screens.

**Files:**
- Modify: `src/routes/index.tsx`

- [ ] **Step 1: Update the main App layout container**

In `src/routes/index.tsx`, in the `App` function (line ~54), change:
```tsx
<div className="flex gap-8">
```
to:
```tsx
<div className="flex flex-col xl:flex-row gap-8">
```

- [ ] **Step 2: Update the stats column classes**

In the same `App` function, the stats column is rendered conditionally:
```tsx
{isLoggedIn ? (
  <UserStatsCard />
) : (
  <AnonymousStatsColumn ... />
)}
```

Wrap the stats column in a `<div>` with responsive classes. Change it from:
```tsx
{isLoggedIn ? (
  <UserStatsCard />
) : (
  <AnonymousStatsColumn
    trendingRooms={homeData.trendingRooms}
    communityStats={homeData.communityStats}
    globalStats={homeData.globalStats}
  />
)}
```
to:
```tsx
<div className="w-full xl:w-72 xl:shrink-0">
  {isLoggedIn ? (
    <UserStatsCard />
  ) : (
    <AnonymousStatsColumn
      trendingRooms={homeData.trendingRooms}
      communityStats={homeData.communityStats}
      globalStats={homeData.globalStats}
    />
  )}
</div>
```

- [ ] **Step 3: Update the HomePageSkeleton to match**

In the `HomePageSkeleton` function (line ~10), apply the same layout changes:

Change:
```tsx
<div className="flex gap-8">
  <div className="flex-1 min-w-0">
    ...
  </div>
  <div className="hidden xl:block w-72 shrink-0">
    <div className="h-80 bg-depth-1 rounded-xl border border-border-subtle animate-pulse" />
  </div>
</div>
```
to:
```tsx
<div className="flex flex-col xl:flex-row gap-8">
  <div className="flex-1 min-w-0">
    ...
  </div>
  <div className="w-full xl:w-72 xl:shrink-0">
    <div className="h-80 bg-depth-1 rounded-xl border border-border-subtle animate-pulse" />
  </div>
</div>
```

- [ ] **Step 4: Run lint**

```bash
cd /home/hshekhar/Code/BhayanakCast && pnpm check
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/routes/index.tsx
git commit -m "feat: show stats panel below room list on mobile"
```

---

## Task 4: Room Page — Stack Layout on Mobile

The active room layout uses `flex` with a fixed-width `w-80 min-w-80` chat sidebar. On mobile this overflows. We stack it vertically.

**Files:**
- Modify: `src/routes/room.$roomId.tsx`

- [ ] **Step 1: Fix the outer room container**

In `src/routes/room.$roomId.tsx`, in `ActiveRoomLayout`, the outer div (line ~571) is:
```tsx
<div className="h-full w-full bg-depth-0 overflow-hidden">
```
Change to:
```tsx
<div className="w-full bg-depth-0 md:h-full md:overflow-hidden">
```
This lets mobile scroll naturally via the parent `overflow-auto` in root.tsx.

- [ ] **Step 2: Fix the two-column flex container**

The columns container (line ~585) is:
```tsx
<div className="flex h-[calc(100%-53px)]">
```
Change to:
```tsx
<div className="flex flex-col md:flex-row md:h-[calc(100%-53px)]">
```

- [ ] **Step 3: Fix the left column (video + controls)**

The left column (line ~587) is:
```tsx
<div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
```
Change to:
```tsx
<div className="flex-1 flex flex-col min-w-0 md:overflow-y-auto">
```
On mobile the outer page scrolls, so we don't need overflow-y-auto here.

- [ ] **Step 4: Fix the chat sidebar column**

The right sidebar (line ~710) is:
```tsx
<div className="w-80 min-w-80 border-l border-border-subtle bg-depth-1 flex flex-col">
```
Change to:
```tsx
<div className="w-full md:w-80 md:min-w-80 border-t md:border-t-0 md:border-l border-border-subtle bg-depth-1 flex flex-col min-h-96 md:min-h-0">
```
- `w-full md:w-80 md:min-w-80`: full width on mobile, fixed 320px on desktop
- `border-t md:border-t-0 md:border-l`: top separator on mobile, left separator on desktop
- `min-h-96`: ensures chat panel is at least 384px tall on mobile so it's usable

- [ ] **Step 5: Run lint**

```bash
cd /home/hshekhar/Code/BhayanakCast && pnpm check
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/routes/room.\$roomId.tsx
git commit -m "feat: stack room layout vertically on mobile"
```

---

## Task 5: Safe Area Insets

Notched phones (iPhone X+, many Android flagships) have hardware notches and home indicators that overlap content. CSS `env(safe-area-inset-*)` accounts for these.

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Add safe area utility class at the end of styles.css**

Append to the bottom of `src/styles.css`:
```css
/* ============================================
   MOBILE SAFE AREAS (notched phones)
   ============================================ */

@supports (padding: env(safe-area-inset-bottom)) {
  .safe-bottom {
    padding-bottom: env(safe-area-inset-bottom);
  }
}
```

- [ ] **Step 2: Apply safe-bottom to the Chat input**

The chat input is the bottom-most interactive element on mobile — the home indicator on iPhone can cover it without this. In `src/components/Chat.tsx`, the input area div (line ~278) is:
```tsx
<div className="p-3 border-t border-border-subtle bg-depth-2">
```
Change to:
```tsx
<div className="p-3 border-t border-border-subtle bg-depth-2 safe-bottom">
```

- [ ] **Step 3: Run lint**

```bash
cd /home/hshekhar/Code/BhayanakCast && pnpm check
```

Expected: no errors

- [ ] **Step 4: Run all unit tests**

```bash
cd /home/hshekhar/Code/BhayanakCast && pnpm test:unit
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/styles.css src/components/Header.tsx src/components/Chat.tsx
git commit -m "feat: add safe-area-inset support for notched phones"
```

---

## Task 6: Verification

- [ ] **Step 1: Start the dev server**

```bash
cd /home/hshekhar/Code/BhayanakCast && pnpm dev
```

- [ ] **Step 2: Open Chrome DevTools → Toggle device toolbar (Ctrl+Shift+M)**

Test at these viewports:
- **390×844** (iPhone 14)
- **360×800** (Android mid-range)
- **1280×800** (desktop — regression check)

- [ ] **Step 3: Verify home page on mobile**
  - Top bar visible (BhayanakCast + theme icon + user icon)
  - Sidebar hidden
  - Room list fills full width
  - Stats card appears below the room list (scroll down)

- [ ] **Step 4: Verify room page on mobile**
  - Video stretches full width (16:9)
  - Action buttons appear below video
  - Chat section appears below buttons (min-height 384px)
  - Chat input stays accessible (no keyboard overlap issues on device)

- [ ] **Step 5: Verify desktop regression at 1280px**
  - Sidebar visible on left (collapsed, 64px)
  - Top bar hidden
  - Home page right stats column visible
  - Room page two-column layout intact

- [ ] **Step 6: Final commit with branch ready for PR**

```bash
cd /home/hshekhar/Code/BhayanakCast && git log --oneline feat/mobile-responsive
```

Expected output lists the 4 feature commits from tasks 2–5.
