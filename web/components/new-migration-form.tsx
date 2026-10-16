"use client";

import { useActionState, useRef, useState } from "react";
import { CircleAlert, GitBranch, Loader2, Lock, Play } from "lucide-react";

import { startMigration, type StartMigrationState } from "@/app/migrations/new/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Dependency, InstalledRepository } from "@/lib/github";

type Load<T> =
  { state: "idle" } | { state: "loading" } | { state: "ready"; data: T } | { state: "error"; message: string };

interface Versions {
  latest: string | null;
  versions: string[];
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed with status ${response.status}`);
  return body;
}

// Matches the branch name the worker pushes (see migration.processor.ts).
function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const TRIGGER = "h-10 w-full px-3 data-[size=default]:h-10";
const CONTENT = "max-h-72";
// Lines option text up with the trigger's and gives each row a comfortable target.
const ITEM = "py-2 pl-3";

export function NewMigrationForm({ repositories }: { repositories: InstalledRepository[] }) {
  const [formState, action, pending] = useActionState<StartMigrationState, FormData>(startMigration, { error: null });
  const [repository, setRepository] = useState("");
  const [dependency, setDependency] = useState("");
  const [version, setVersion] = useState("");
  const [dependencies, setDependencies] = useState<Load<Dependency[] | null>>({ state: "idle" });
  const [versions, setVersions] = useState<Load<Versions>>({ state: "idle" });
  // Choices can change faster than the requests return; only the newest one may land.
  const latestRequest = useRef(0);

  // React resets a form after its action runs, and Radix reports that as a change
  // to "". Ignoring it keeps the user's choices on screen next to the error. The
  // values are submitted through hidden inputs, which a reset leaves alone, so
  // a retry sends what the form shows rather than the native selects' defaults.
  async function pickRepository(value: string) {
    if (!value) return;
    const request = ++latestRequest.current;
    setRepository(value);
    setDependency("");
    setVersion("");
    setVersions({ state: "idle" });
    setDependencies({ state: "loading" });
    try {
      const body = await getJson<{ dependencies: Dependency[] | null }>(
        `/api/repositories/dependencies?repo=${encodeURIComponent(value)}`,
      );
      if (request === latestRequest.current) setDependencies({ state: "ready", data: body.dependencies });
    } catch (error) {
      if (request === latestRequest.current) setDependencies({ state: "error", message: (error as Error).message });
    }
  }

  async function pickDependency(value: string) {
    if (!value) return;
    const request = ++latestRequest.current;
    setDependency(value);
    setVersion("");
    setVersions({ state: "loading" });
    try {
      const body = await getJson<Versions>(`/api/npm/versions?name=${encodeURIComponent(value)}`);
      if (request !== latestRequest.current) return;
      setVersions({ state: "ready", data: body });
      setVersion(body.latest && body.versions.includes(body.latest) ? body.latest : (body.versions[0] ?? ""));
    } catch (error) {
      if (request === latestRequest.current) setVersions({ state: "error", message: (error as Error).message });
    }
  }

  const current =
    dependencies.state === "ready" ? dependencies.data?.find((entry) => entry.name === dependency) : undefined;
  const ready = Boolean(repository && dependency && version);

  return (
    <form action={action} className="corner-mark flex flex-col border bg-card">
      <input type="hidden" name="repository" value={repository} />
      <input type="hidden" name="dependency" value={dependency} />
      <input type="hidden" name="version" value={version} />
      <div className="flex flex-col gap-6 p-5 sm:p-6">
        <Field
          id="repository"
          step="01"
          label="Repository"
          hint={`${repositories.length} available through your installations`}
        >
          <Select value={repository} onValueChange={pickRepository} disabled={pending}>
            <SelectTrigger id="repository" className={TRIGGER}>
              <SelectValue placeholder="Choose a repository" />
            </SelectTrigger>
            <SelectContent position="popper" className={CONTENT}>
              {repositories.map((entry) => (
                <SelectItem key={entry.id} value={entry.fullName} className={ITEM}>
                  {entry.fullName}
                  {entry.private && <Lock aria-label="Private" className="size-3.5 text-muted-foreground" />}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field id="dependency" step="02" label="Dependency" hint={dependencyHint(dependencies, current)}>
          <Select
            value={dependency}
            onValueChange={pickDependency}
            disabled={pending || dependencies.state !== "ready" || !dependencies.data?.length}
          >
            <SelectTrigger id="dependency" className={TRIGGER} aria-busy={dependencies.state === "loading"}>
              <SelectValue
                placeholder={dependencies.state === "loading" ? "Reading package.json…" : "Choose a dependency"}
              />
            </SelectTrigger>
            <SelectContent position="popper" className={CONTENT}>
              {dependencies.state === "ready" &&
                dependencies.data?.map((entry) => (
                  <SelectItem key={`${entry.name}-${entry.dev}`} value={entry.name} className={ITEM}>
                    {entry.name}
                    <span className="font-mono text-xs text-muted-foreground">{entry.range}</span>
                    {entry.dev && <span className="label-mono text-[0.625rem] text-muted-foreground">dev</span>}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </Field>

        <Field id="version" step="03" label="Target version" hint={versionHint(versions, current, version)}>
          <Select
            value={version}
            onValueChange={(value) => value && setVersion(value)}
            disabled={pending || versions.state !== "ready" || versions.data.versions.length === 0}
          >
            <SelectTrigger id="version" className={TRIGGER} aria-busy={versions.state === "loading"}>
              <SelectValue
                placeholder={versions.state === "loading" ? "Loading versions from npm…" : "Choose a version"}
              />
            </SelectTrigger>
            <SelectContent position="popper" className={CONTENT}>
              {versions.state === "ready" &&
                versions.data.versions.map((entry) => (
                  <SelectItem key={entry} value={entry} className={ITEM}>
                    <span className="font-mono">{entry}</span>
                    {entry === versions.data.latest && (
                      <span className="bg-primary/12 px-1.5 py-0.5 font-sans label-mono text-[0.625rem] text-primary">
                        latest
                      </span>
                    )}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </Field>

        {formState.error && (
          <p
            role="alert"
            className="flex items-start gap-2.5 border border-status-failed/30 bg-status-failed/10 px-4 py-3 text-sm"
          >
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-status-failed" />
            {formState.error}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t bg-accent/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <GitBranch aria-hidden className="size-4 shrink-0" />
          {ready ? (
            <span className="truncate">
              Opens{" "}
              <span className="font-mono text-xs text-foreground">
                synclab/{slug(dependency)}-{slug(version)}
              </span>{" "}
              on {repository}
            </span>
          ) : (
            "The pull request branch appears here once everything is picked."
          )}
        </p>
        <Button type="submit" size="lg" disabled={!ready || pending} className="h-10 shrink-0 px-4">
          {pending ? <Loader2 aria-hidden className="animate-spin" /> : <Play aria-hidden />}
          {pending ? "Starting…" : "Start migration"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  step,
  label,
  hint,
  children,
}: {
  id: string;
  step: string;
  label: string;
  hint: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} className="gap-2.5">
        <span className="label-mono text-muted-foreground">{step}</span>
        {label}
      </Label>
      {children}
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {hint}
      </p>
    </div>
  );
}

function dependencyHint(dependencies: Load<Dependency[] | null>, current: Dependency | undefined): React.ReactNode {
  switch (dependencies.state) {
    case "idle":
      return "Read from the repository's root package.json.";
    case "loading":
      return "Reading package.json…";
    case "error":
      return <span className="text-status-failed">{dependencies.message}</span>;
    case "ready":
      if (!dependencies.data) return "This repository has no package.json at its root.";
      if (dependencies.data.length === 0) return "package.json declares no dependencies.";
      return current ? (
        <>
          Currently <span className="font-mono">{current.range}</span>
          {current.dev ? " in devDependencies" : ""}.
        </>
      ) : (
        `${dependencies.data.length} declared in package.json.`
      );
  }
}

function versionHint(versions: Load<Versions>, current: Dependency | undefined, version: string): React.ReactNode {
  // "^16.4.1" and "16.4.1" both pin the version the repository already has.
  if (versions.state === "ready" && current && current.range.replace(/^[\^~=v\s]+/, "") === version) {
    return <span className="text-foreground">package.json already asks for {version}. Pick a newer release.</span>;
  }
  switch (versions.state) {
    case "idle":
      return "Stable releases from the npm registry, newest first.";
    case "loading":
      return "Loading versions from npm…";
    case "error":
      return <span className="text-status-failed">{versions.message}</span>;
    case "ready":
      return versions.data.versions.length
        ? "Stable releases from the npm registry, newest first."
        : "npm lists no stable releases.";
  }
}
