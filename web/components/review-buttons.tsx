"use client";

import { useActionState } from "react";
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
  const [state, action] = useActionState<ReviewState, FormData>(
    (_previous, form) => reviewChange(changeId, form.get("decision") as ApiChangeDecision),
    { error: null },
  );

  if (!canReview && !state.error) return null;

  return (
    <form action={action} className="flex flex-col gap-1.5">
      {canReview && (
        <div role="group" aria-label={`Review ${subject}`} className="flex flex-wrap gap-1.5">
          {DECISIONS.filter(({ from }) => from.includes(status)).map((props) => (
            <DecisionButton key={props.decision} {...props} />
          ))}
        </div>
      )}
      {state.error && (
        <p role="alert" className="text-xs text-status-failed">
          {state.error}
        </p>
      )}
    </form>
  );
}
