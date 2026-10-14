// Report a problem from the room (CONTEXT.md, Problem report; ADR 4 addendum on problem reports).
// Two entries: the quality modal of a stream (the report knows which stream) and the room info
// menu (a general report). Pick what went wrong, add a note if you like, send: one tap once a
// category is chosen, and the note never blocks it. The reporter gets a short thank-you toast;
// nothing appears for anyone else. The server allows one report per person per minute, and the
// form stops repeats before that.
import { type RefObject, useCallback, useEffect, useId, useRef, useState } from "react";
import {
  PROBLEM_CATEGORIES,
  PROBLEM_CATEGORY_LABELS,
  PROBLEM_NOTE_MAX,
  type ProblemCategory,
  REPORT_PERSON_WINDOW_MS,
} from "~/lib/problem-report";
import { reportProblemFn } from "~/lib/problem-report.functions";
import type { ReportSnapshot } from "~/lib/report-snapshot";
import { Sheet } from "../overlays";
import { Btn, fieldInput, fieldLabel } from "../ui";
import { roomToasts } from "./room-toasts";

/** What the form hands over; the stream is set by the quality modal it was opened from. */
export interface ProblemForm {
  category: ProblemCategory;
  note: string;
  streamUserId?: string;
}

export type SendOutcome = "sent" | "too_soon" | "failed";

/** Sends reports for one room; the room page makes one (`useProblemReporter`). */
export interface ProblemReporter {
  send: (form: ProblemForm) => Promise<SendOutcome>;
  /** The server wants a minute between one person's reports: true until it has passed. */
  blocked: boolean;
}

/** Sending reports for `roomId`, with this page's `snapshot` (`useRoomMesh`) attached. */
export function useProblemReporter(
  roomId: string,
  snapshot: () => ReportSnapshot,
): ProblemReporter {
  const [until, setUntil] = useState(0);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const wait = until - Date.now();
    if (wait <= 0) return setBlocked(false);
    setBlocked(true);
    const timer = setTimeout(() => setBlocked(false), wait);
    return () => clearTimeout(timer);
  }, [until]);

  const send = useCallback(
    async ({ category, note, streamUserId }: ProblemForm): Promise<SendOutcome> => {
      try {
        const result = await reportProblemFn({
          data: {
            roomId,
            category,
            ...(note.trim() && { note }),
            ...(streamUserId && { streamUserId }),
            snapshot: snapshot(),
          },
        });
        if (result.status === "sent") {
          setUntil(Date.now() + REPORT_PERSON_WINDOW_MS);
          roomToasts.add({ title: "thanks, we got your report" });
          return "sent";
        }
        if (result.status === "too_soon") {
          setUntil(Date.now() + result.retryInMs);
          return "too_soon";
        }
        return "failed";
      } catch {
        return "failed";
      }
    },
    [roomId, snapshot],
  );
  return { send, blocked };
}

/** What has been filled in, and sending it. */
function useDraft(reporter: ProblemReporter, streamUserId: string | undefined, onSent: () => void) {
  const [category, setCategory] = useState<ProblemCategory | null>(null);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<"too_soon" | "failed" | null>(null);
  const canSend = category !== null && !pending && !reporter.blocked;
  const reset = useCallback(() => {
    setCategory(null);
    setNote("");
    setProblem(null);
  }, []);
  const submit = async () => {
    if (!category || !canSend) return;
    setPending(true);
    setProblem(null);
    const outcome = await reporter.send({ category, note, streamUserId });
    setPending(false);
    if (outcome === "sent") onSent();
    else setProblem(outcome);
  };
  return { category, setCategory, note, setNote, pending, problem, canSend, submit, reset };
}
type Draft = ReturnType<typeof useDraft>;

const chip =
  "h-[26px] px-2.5 inline-flex items-center rounded-full text-[11px] border cursor-pointer select-none transition-colors bg-canvas border-border text-fg-muted hover:text-fg hover:border-border-strong has-[:checked]:bg-primary has-[:checked]:text-primary-ink has-[:checked]:border-transparent has-[:checked]:font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary";

/** The category and the note. `first` gets the first category's input, to focus it. */
function Fields({
  draft,
  name,
  first,
}: {
  draft: Draft;
  name: string;
  first?: RefObject<HTMLInputElement | null>;
}) {
  const counter = useId();
  return (
    <>
      <fieldset className="m-0 p-0 border-0 flex flex-col gap-2">
        <legend className={`${fieldLabel} mb-2 p-0`}>what went wrong?</legend>
        <div className="flex flex-wrap gap-1.5">
          {PROBLEM_CATEGORIES.map((category, i) => (
            <label key={category} className={chip}>
              <input
                ref={i === 0 ? first : undefined}
                type="radio"
                name={name}
                value={category}
                checked={draft.category === category}
                onChange={() => draft.setCategory(category)}
                className="sr-only"
              />
              {PROBLEM_CATEGORY_LABELS[category]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label className="flex flex-col gap-1.5">
          <span className={fieldLabel}>note (optional)</span>
          <textarea
            value={draft.note}
            onChange={(e) => draft.setNote(e.target.value)}
            maxLength={PROBLEM_NOTE_MAX}
            rows={3}
            aria-describedby={counter}
            placeholder="anything that helps, like what you saw or when it started"
            className={`${fieldInput} resize-none`}
          />
        </label>
        {/* Outside the label, so it is the field's description and not part of its name. */}
        <span id={counter} className="self-end text-[10.5px] text-muted tabular-nums">
          {draft.note.length}/{PROBLEM_NOTE_MAX}
        </span>
      </div>
    </>
  );
}

/** Why the report can't be sent now, or that it didn't go. */
function Status({ draft, reporter }: { draft: Draft; reporter: ProblemReporter }) {
  const text =
    draft.problem === "failed"
      ? "couldn't send that. try again?"
      : reporter.blocked || draft.problem === "too_soon"
        ? "you just sent a report. you can send another in a minute."
        : null;
  return (
    <p
      role={draft.problem === "failed" ? "alert" : "status"}
      className={text ? "m-0 mr-auto text-[11.5px] text-muted" : "sr-only"}
    >
      {text}
    </p>
  );
}

/**
 * The form inside a stream's quality modal, for the report on `streamUserId`'s stream: opened
 * by the modal's "report a problem" button, closed (`onDone`) once sent or (`onCancel`) given up.
 * It takes focus when it opens, on the first category; the modal puts it back on the button.
 */
export function InlineReportForm({
  reporter,
  streamUserId,
  onDone,
  onCancel,
}: {
  reporter: ProblemReporter;
  streamUserId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const draft = useDraft(reporter, streamUserId, onDone);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <form
      aria-label="report a problem"
      className="flex flex-col gap-3 pt-3 border-t border-dashed border-border-subtle"
      onSubmit={(e) => {
        e.preventDefault();
        void draft.submit();
      }}
    >
      <Fields draft={draft} name={`report-category-${streamUserId}`} first={first} />
      <div className="flex items-center justify-end gap-2">
        <Status draft={draft} reporter={reporter} />
        <Btn size="sm" onClick={onCancel}>
          cancel
        </Btn>
        <Btn type="submit" variant="primary" size="sm" disabled={!draft.canSend}>
          send report
        </Btn>
      </div>
    </form>
  );
}

/** The room menu's report: a general one, about no stream in particular. */
export function ReportProblemSheet({
  open,
  onClose,
  reporter,
}: {
  open: boolean;
  onClose: () => void;
  reporter: ProblemReporter;
}) {
  const draft = useDraft(reporter, undefined, onClose);
  const { reset } = draft;
  // Each report starts from a blank form.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="report a problem"
      width="w-[min(460px,96vw)]"
      footer={
        <>
          <Status draft={draft} reporter={reporter} />
          <Btn type="submit" form={SHEET_FORM} variant="primary" disabled={!draft.canSend}>
            send report
          </Btn>
        </>
      }
    >
      <form
        id={SHEET_FORM}
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void draft.submit();
        }}
      >
        <p className="m-0 text-[12px] text-muted leading-relaxed">
          for a problem that isn't about one screen: audio, lag, not connecting. for a blurry or
          frozen screen, open its quality view and report from there.
        </p>
        <Fields draft={draft} name="report-category" />
      </form>
    </Sheet>
  );
}

const SHEET_FORM = "report-problem-form";
