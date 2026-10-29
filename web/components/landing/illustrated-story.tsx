"use client";

import { useId, useState } from "react";
import { ArrowRight, Check, GitPullRequest } from "lucide-react";
import Image from "next/image";
import { nextWorkflowStage } from "@/lib/workflow-stage";
import {
  CapabilityDiagram,
  CodebaseArchitecture,
} from "./architecture-illustrations";
import styles from "./illustrated-story.module.css";
import { useScrollChapter } from "./scroll-chapter";

const STAGES = [
  {
    label: "Detect",
    title: "The change starts outside your codebase.",
    body: "SyncLab watches provider sources and dependency releases, then keeps the evidence behind each breaking change.",
    detail: "Provider notice → model retirement",
    file: "provider / release notes",
  },
  {
    label: "Locate",
    title: "The notice becomes a map of affected code.",
    body: "The scanner connects the changed model, parameter, or SDK to the calls in your JavaScript and TypeScript.",
    detail: "2 affected calls in this example",
    file: "src/summarize.ts · src/api/chat.ts",
  },
  {
    label: "Refactor",
    title: "The affected code gets a focused rewrite.",
    body: "SyncLab works through the change in an isolated migration, updating the usage that needs attention.",
    detail: "A scoped change on its own branch",
    file: "synclab / model-migration",
  },
  {
    label: "Verify",
    title: "Your tests have the final say.",
    body: "The repository suite checks the proposed change. Failed output feeds the next attempt; each result stays with the run.",
    detail: "13 example checks passed",
    file: "typecheck · repository tests",
  },
  {
    label: "Review",
    title: "A proposed fix, ready for your judgment.",
    body: "Review the changed calls, the provider evidence, and the test output together in a pull request.",
    detail: "2 files changed · human review next",
    file: "main ← synclab/model-migration",
  },
];

export function IllustratedWorkflow() {
  const [localStage, setLocalStage] = useState(0);
  const chapter = useScrollChapter();
  const stage = chapter?.step ?? localStage;
  const setStage = chapter?.selectStep ?? setLocalStage;
  const id = useId();
  return (
    <div className={styles.workflow} data-workflow-showcase>
      <figure className={styles.architectureFrame}>
        <CodebaseArchitecture stage={stage} />
        <figcaption className={styles.srOnly}>
          An original architectural illustration of the SyncLab migration
          process, from provider evidence to human review.
        </figcaption>
      </figure>
      <div
        className={styles.stageTabs}
        role="tablist"
        aria-label="Migration walkthrough"
      >
        {STAGES.map((item, index) => (
          <button
            key={item.label}
            type="button"
            role="tab"
            id={`${id}-tab-${index}`}
            aria-controls={`${id}-panel`}
            aria-selected={stage === index}
            tabIndex={stage === index ? 0 : -1}
            onClick={() => setStage(index)}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next = nextWorkflowStage(stage, event.key, STAGES.length);
              setStage(next);
              event.currentTarget.parentElement
                ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                [next]?.focus();
            }}
          >
            <span aria-hidden>0{index + 1}</span>
            {item.label}
            <ArrowRight size={15} aria-hidden />
          </button>
        ))}
      </div>
      <div
        className={styles.stageExplanation}
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${stage}`}
        tabIndex={0}
      >
        <div>
          <h3>{STAGES[stage].title}</h3>
          <p>{STAGES[stage].body}</p>
        </div>
        <div className={styles.stageEvidence}>
          <span className={styles.label}>{STAGES[stage].detail}</span>
          <code>{STAGES[stage].file}</code>
          <span className={styles.example}>
            Illustrative architecture and data
          </span>
        </div>
      </div>
    </div>
  );
}

const CAPABILITIES = [
  {
    kind: "signal" as const,
    label: "01 / Monitor",
    title: "Catch the change at its source.",
    body: "Provider notices, deprecations, and release notes become changes with evidence attached.",
  },
  {
    kind: "usage" as const,
    label: "02 / Understand",
    title: "Find the calls that depend on it.",
    body: "Trace a changed API or dependency to the exact usage in your repository.",
  },
  {
    kind: "tests" as const,
    label: "03 / Verify",
    title: "Let your own suite check the fix.",
    body: "Run the tests around the change. Keep the output, and use failures to refine the next attempt.",
  },
  {
    kind: "review" as const,
    label: "04 / Review",
    title: "Keep the decision in your hands.",
    body: "A focused diff, its test results, and a pull request your team can review.",
  },
];

export function IllustratedCapabilities() {
  const [localStep, setLocalStep] = useState(0);
  const chapter = useScrollChapter();
  const step = chapter?.step ?? localStep;
  const select = chapter?.selectStep ?? setLocalStep;
  return (
    <div className={styles.capabilitySequence}>
      <div className={styles.capabilityGrid}>
        {CAPABILITIES.map((item, index) => (
          <article
            className={styles.capability}
            key={item.kind}
            data-revealed={!chapter?.pinned || index <= step}
            data-active={index === step}
          >
            <button
              type="button"
              className={`${styles.label} ${styles.capabilityStep}`}
              aria-pressed={index === step}
              onClick={() => select(index)}
            >
              {item.label}
            </button>
            <div className={styles.miniature} data-capability-illustration>
              <CapabilityDiagram kind={item.kind} />
            </div>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </article>
        ))}
      </div>
      <p className={styles.capabilitySummary} aria-live="polite">
        {CAPABILITIES[step].body}
      </p>
    </div>
  );
}

export function IllustratedBeforeAfter() {
  const chapter = useScrollChapter();
  const fixed = !chapter?.pinned || chapter.step === 1;
  return (
    <div className={styles.beforeAfter}>
      <div className={styles.benchFrame}>
        <div
          className={styles.engineerScene}
          data-fixed={fixed}
          role="img"
          aria-label={
            !chapter?.pinned
              ? "A white dotted scene of an engineer manually debugging, followed by a blue-accented dark scene of the same engineer calmly reviewing a proposed fix"
              : fixed
                ? "The same engineer calmly reviewing proposed code changes on the monitors"
                : "A software engineer hunched over a computer, manually debugging broken API calls and failing example checks"
          }
        >
          <div className={`${styles.engineerPanel} ${styles.engineerBefore}`}>
            <Image
              src="/illustrations/engineer-pointcloud-light-before.png"
              alt=""
              aria-hidden="true"
              fill
              sizes="(max-width: 760px) 100vw, (max-width: 1440px) 92vw, 1336px"
              className={styles.engineerLayer}
            />
          </div>
          <div className={`${styles.engineerPanel} ${styles.engineerAfter}`} data-engineer-reveal>
            <Image
              src="/illustrations/engineer-pointcloud-blue-clean.png"
              alt=""
              aria-hidden="true"
              fill
              sizes="(max-width: 760px) 100vw, (max-width: 1440px) 92vw, 1336px"
              className={styles.engineerLayer}
            />
          </div>
        </div>
      </div>
      <div className={styles.proofStrip} aria-live="polite">
        <div>
          <strong>{fixed ? "2 / 2" : "2"}</strong>
          <span>
            {fixed ? "Example calls updated" : "Example calls affected"}
          </span>
        </div>
        <div>
          <strong>{fixed ? "13 / 13" : "11 / 13"}</strong>
          <span>
            {fixed ? "Example checks passed" : "Example checks passing"}
          </span>
        </div>
        <div>
          <strong>
            {fixed ? (
              <Check size={27} strokeWidth={1.5} />
            ) : (
              <span className={styles.minus}>-</span>
            )}
          </strong>
          <span>
            {fixed ? "Proposed diff ready" : "Fix awaiting verification"}
          </span>
        </div>
        <div>
          <strong>
            <GitPullRequest size={27} strokeWidth={1.5} />
          </strong>
          <span>Human review required</span>
        </div>
      </div>
      <p className={styles.example}>
        Illustrative migration. These counts describe the example, not a
        recorded production run.
      </p>
    </div>
  );
}
