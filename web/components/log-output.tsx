"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { tailLines } from "@/lib/format";

/** Output longer than this folds to its last lines, where npm prints the error. */
const FOLD_AFTER = 24;
const TAIL = 12;

/**
 * One step's command output. A failed step opens in full, because the whole
 * output is what you came to read.
 */
export function LogOutput({ body, failed }: { body: string; failed: boolean }) {
  const [expanded, setExpanded] = useState(failed);
  const { hidden, text } = tailLines(body, TAIL);
  const foldable = hidden + TAIL > FOLD_AFTER;
  const folded = foldable && !expanded;

  return (
    <div className="flex flex-col">
      {foldable && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="w-fit py-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {folded ? `Show ${hidden.toLocaleString("en")} earlier lines` : `Show only the last ${TAIL} lines`}
        </button>
      )}
      <div className="group/output relative">
        <pre className="overflow-x-auto bg-log py-2.5 pr-11 pl-3 font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-foreground/85">
          {folded ? text : body}
        </pre>
        <CopyButton text={body} />
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true))}
      className="absolute top-1.5 right-1.5 text-muted-foreground opacity-0 group-hover/output:opacity-100 hover:text-foreground focus-visible:opacity-100 data-[copied]:opacity-100 [@media(hover:none)]:opacity-100"
      data-copied={copied || undefined}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      <span className="sr-only">{copied ? "Copied" : "Copy output"}</span>
    </Button>
  );
}
