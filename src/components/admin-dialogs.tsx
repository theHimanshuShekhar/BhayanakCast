// Admin confirmation dialogs (spec #7): ban, unban, promote and demote, on the shared Base UI
// Dialog sheet.
import { useState } from "react";
import { type AdminRole, BAN_REASON_MAX, type BanDuration, type BanUserInput } from "~/lib/admin";
import { Sheet } from "./overlays";
import { Btn, fieldInput, fieldLabel, Seg } from "./ui";

const DURATIONS: { k: string; v: BanDuration }[] = [
  { k: "1 day", v: "1d" },
  { k: "7 days", v: "7d" },
  { k: "permanent", v: "permanent" },
];

/** Who a dialog acts on. */
export interface DialogTarget {
  id: string;
  username: string;
}

const Failed = ({ children }: { children: string }) => (
  <p role="alert" className="m-0 text-[11.5px] text-live-ink">
    {children}
  </p>
);

/**
 * Ban `target` with a reason and how long. Banning signs them out everywhere and removes them
 * from any live room at once.
 */
export const BanUserDialog = ({
  target,
  onOpenChange,
  onBan,
}: {
  /** Null while closed. */
  target: DialogTarget | null;
  onOpenChange: (open: boolean) => void;
  /** Bans; rejects if the server refuses. */
  onBan: (ban: BanUserInput) => Promise<unknown>;
}) => {
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState<BanDuration>("7d");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const close = (open: boolean) => {
    if (open) return;
    setReason("");
    setDuration("7d");
    setFailed(false);
    onOpenChange(false);
  };
  const submit = async () => {
    if (!target || !reason.trim() || pending) return;
    setPending(true);
    setFailed(false);
    try {
      await onBan({ userId: target.id, reason: reason.trim(), duration });
      close(false);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <Sheet
      open={target !== null}
      onOpenChange={close}
      title={`ban ${target?.username ?? ""}`}
      width="w-[min(440px,94vw)]"
      footer={
        <>
          <Btn onClick={() => close(false)}>cancel</Btn>
          <Btn variant="danger" onClick={submit} disabled={!reason.trim() || pending}>
            ban user
          </Btn>
        </>
      }
    >
      <form
        className="contents"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="m-0 text-[12.5px] text-muted leading-relaxed">
          They're signed out everywhere, removed from any live room right away, and can't sign in
          until the ban ends.
        </p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ban-reason" className={fieldLabel}>
            reason
          </label>
          <textarea
            id="ban-reason"
            rows={2}
            placeholder="shown to them on sign-in"
            value={reason}
            maxLength={BAN_REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
            className={`${fieldInput} resize-none font-[inherit]`}
          />
        </div>
        <fieldset className="flex flex-col gap-1.5 m-0 p-0 border-0">
          <legend className={`${fieldLabel} mb-1.5`}>ban for</legend>
          <Seg value={duration} options={DURATIONS} onChange={setDuration} />
        </fieldset>
        {failed && <Failed>couldn't ban them. try again.</Failed>}
      </form>
    </Sheet>
  );
};

/** Lift `target`'s ban. */
export const UnbanUserDialog = ({
  target,
  onOpenChange,
  onUnban,
}: {
  target: DialogTarget | null;
  onOpenChange: (open: boolean) => void;
  onUnban: (userId: string) => Promise<unknown>;
}) => {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const close = (open: boolean) => {
    if (open) return;
    setFailed(false);
    onOpenChange(false);
  };
  const submit = async () => {
    if (!target || pending) return;
    setPending(true);
    setFailed(false);
    try {
      await onUnban(target.id);
      close(false);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };
  return (
    <Sheet
      open={target !== null}
      onOpenChange={close}
      title={`unban ${target?.username ?? ""}`}
      width="w-[min(400px,94vw)]"
      footer={
        <>
          <Btn onClick={() => close(false)}>cancel</Btn>
          <Btn variant="primary" onClick={submit} disabled={pending}>
            unban user
          </Btn>
        </>
      }
    >
      <p className="m-0 text-[12.5px] text-muted leading-relaxed">
        They can sign in and join rooms again straight away.
      </p>
      {failed && <Failed>couldn't unban them. try again.</Failed>}
    </Sheet>
  );
};

/** Who a role change acts on, and the role they'd get. */
export type RoleChangeTarget = DialogTarget & { role: AdminRole };

/** Promote `target` to admin (`role: "admin"`) or demote them to a plain user. */
export const SetRoleDialog = ({
  target,
  onOpenChange,
  onSetRole,
}: {
  /** Null while closed. */
  target: RoleChangeTarget | null;
  onOpenChange: (open: boolean) => void;
  onSetRole: (userId: string, role: AdminRole) => Promise<unknown>;
}) => {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const promote = target?.role === "admin";
  const verb = promote ? "promote" : "demote";
  const close = (open: boolean) => {
    if (open) return;
    setFailed(false);
    onOpenChange(false);
  };
  const submit = async () => {
    if (!target || pending) return;
    setPending(true);
    setFailed(false);
    try {
      await onSetRole(target.id, target.role);
      close(false);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };
  return (
    <Sheet
      open={target !== null}
      onOpenChange={close}
      title={`${verb} ${target?.username ?? ""}`}
      width="w-[min(400px,94vw)]"
      footer={
        <>
          <Btn onClick={() => close(false)}>cancel</Btn>
          <Btn variant={promote ? "primary" : "danger"} onClick={submit} disabled={pending}>
            {promote ? "make admin" : "remove admin"}
          </Btn>
        </>
      }
    >
      <p className="m-0 text-[12.5px] text-muted leading-relaxed">
        {promote
          ? "They get the admin dashboard, bans, and moderation powers in every room."
          : "They lose the admin dashboard, bans, and moderation powers in other people's rooms."}
      </p>
      {failed && <Failed>{`couldn't ${verb} them. try again.`}</Failed>}
    </Sheet>
  );
};
