import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "../stores/useStore";
import { isExecutionIdea, isStaleIdea } from "../lib/ideaLogic";
import type { Idea } from "../types";
import { api } from "../lib/api";

type Summary = {
  idea: Idea;
  tasks: { id: string; status: string }[];
  latestRun: { status: string } | null;
  checks: { conclusion: string }[];
  pullRequests: { id: string; body: string }[];
};

import { useTitle } from "../hooks/useTitle";

function NowCard({ idea, summary }: { idea: Idea; summary?: Summary }) {
  const { openIdea, completeNextAction } = useStore();
  return (
    <section className="card" aria-label={idea.title || "Untitled idea"}>
      <div className="work-row">
        <h2>{idea.title || "Untitled"}</h2>
        <span>
          {idea.status} · {idea.priority}
        </span>
      </div>
      <p>Next action: {idea.nextAction || "Choose a next action"}</p>
      <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
        {idea.dueDate && `Due ${idea.dueDate} · `}
        {idea.reviewAt && `Review ${idea.reviewAt} · `}
        {isStaleIdea(idea) ? "Stale 30d+" : "Recently updated"}
      </p>
      {summary && (
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
          {summary.tasks.filter((task) => task.status !== "done").length} open
          tasks · Agent {summary.latestRun?.status || "not started"} ·{" "}
          {summary.checks.some((check) => check.conclusion === "failure")
            ? "GitHub checks failing"
            : summary.checks.length
              ? "GitHub checks available"
              : "No GitHub checks"}
        </p>
      )}
      <div className="work-form" style={{ marginTop: 16 }}>
        {idea.nextAction && (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => completeNextAction(idea.id)}
          >
            Complete next action
          </button>
        )}
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => openIdea(idea.id)}
        >
          Edit idea
        </button>
        <Link className="btn btn-secondary btn-sm" to={`/work/${idea.id}`}>
          Linked work
        </Link>
        {summary?.pullRequests.map((pr) => (
          <a
            key={pr.id}
            className="btn btn-ghost btn-sm"
            href={pr.body}
            target="_blank"
            rel="noreferrer"
          >
            Pull request
          </a>
        ))}
      </div>
    </section>
  );
}

export default function NowPage() {
  useTitle("Now");
  const { ideas } = useStore();
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    api<Summary[]>("/work/now")
      .then((result) => {
        if (active) {
          setSummaries(result);
          setError("");
        }
      })
      .catch(() => {
        if (active)
          setError(
            "Linked work is unavailable. Idea details remain available offline.",
          );
      });
    return () => {
      active = false;
    };
  }, [retry]);

  const active = ideas
    .filter(isExecutionIdea)
    .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));

  return (
    <main className="work-page">
      <div className="page-heading">
        <div>
          <h1>Now</h1>
          <p>Current work and the next move for each idea.</p>
        </div>
      </div>

      {error && (
        <div className="page-error" role="alert">
          {error}{" "}
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry
          </button>
        </div>
      )}

      {!active.length && (
        <div className="card page-empty">
          <h2>No planned or active ideas yet</h2>
          <p>Process an Inbox idea to start execution.</p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {active.map((idea) => (
          <NowCard
            key={idea.id}
            idea={idea}
            summary={summaries.find((item) => item.idea.id === idea.id)}
          />
        ))}
      </div>
    </main>
  );
}
