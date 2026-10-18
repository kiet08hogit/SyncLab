"use client";

import { createContext, useActionState, useContext, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { CircleCheck, CircleSlash, Loader2, type LucideIcon } from "lucide-react";

import { reviewChange, type ReviewState } from "@/app/(app)/api-changes/actions";
import { Button } from "@/components/ui/button";
import type { ApiChangeDecision, ApiChangeStatus } from "@/lib/types";

const DECISIONS: { decision: ApiChangeDecision; label: string; busyLabel: string; icon: LucideIcon; from: ApiChangeStatus[] }[] = [
  { decision: "confirm", label: "Confirm", busyLabel: "Confirming…", icon: CircleCheck, from: ["detected", "dismissed"] },
  { decision: "dismiss", label: "Dismiss", busyLabel: "Dismissing…", icon: CircleSlash, from: ["detected", "confirmed"] },
];

function DecisionButton({ decision, label, busyLabel, icon: Icon }: (typeof DECISIONS)[number]) {
  const { pending, data } = useFormStatus();
  const busy = pending && data?.get("decision") === decision;
  return (
    <Button type="submit" name="decision" value={decision} variant="outline" size="sm" disabled={pending}>
      {busy ? <Loader2 aria-hidden className="animate-spin" /> : <Icon aria-hidden />}
      {busy ? busyLabel : label}
    </Button>
  );
}

interface ReviewResult extends ReviewState {
  /** The change the last submission was about, so a missing row can still say why. */
  changeId: string | null;
}

const EMPTY_REVIEW: ReviewResult = { error: null, changeId: null };

const ReviewContext = createContext<{ state: ReviewResult; action: (form: FormData) => void } | null>(null);

function submittedId(form: FormData) {
  const value = form.get("changeId");
  return typeof value === "string" ? value : "";
}

/**
 * Holds the last review result above the list. A deleted change refreshes its
 * row away, and this is what still shows "this change no longer exists."
 */
export function ReviewProvider({ changeIds, children }: { changeIds: string[]; children: ReactNode }) {
  const [state, action] = useActionState<ReviewResult, FormData>(
    (_previous, form) =>
      reviewChange(submittedId(form), form.get("decision") as ApiChangeDecision).then((result) => ({
        ...result,
        changeId: submittedId(form),
      })),
    EMPTY_REVIEW,
  );
  const orphaned = Boolean(state.error && state.changeId && !changeIds.includes(state.changeId));

  return (
    <ReviewContext.Provider value={{ state, action }}>
      <div className="flex flex-col gap-3">
        {orphaned && (
          <p role="alert" className="text-xs text-status-failed">
            {state.error}
          </p>
        )}
        {children}
      </div>
    </ReviewContext.Provider>
  );
}

/**
 * The decisions that move a change out of its current status. Stays mounted
 * when the user may not review, so a refusal that refreshes the row away from
 * its buttons still shows why.
 */
export function ReviewButtons({
  changeId,
  subject,
  status,
  canReview,
}: {
  changeId: string;
  /** What the change is about, so each row's buttons are told apart by assistive tech. */
  subject: string;
  status: ApiChangeStatus;
  canReview: boolean;
}) {
  const review = useContext(ReviewContext);
  const error = review?.state.changeId === changeId ? review.state.error : null;
  if (!review || (!canReview && !error)) return null;

  return (
    <form action={review.action} className="flex flex-col gap-1.5">
      <input type="hidden" name="changeId" value={changeId} />
      {canReview && (
        <div role="group" aria-label={`Review ${subject}`} className="flex flex-wrap gap-1.5">
          {DECISIONS.filter(({ from }) => from.includes(status)).map((props) => (
            <DecisionButton key={props.decision} {...props} />
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-status-failed">
          {error}
        </p>
      )}
    </form>
  );
}
