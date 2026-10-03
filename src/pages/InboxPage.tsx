import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../stores/useStore";
import { isInboxIdea } from "../lib/ideaLogic";
import { api } from "../lib/api";
import type { Idea } from '../types';

import { useTitle } from "../hooks/useTitle";

function InboxCard({
  idea,
  tab,
  busyId,
  onConvert,
}: {
  idea: Idea;
  tab: "ready" | "deferred";
  busyId: string;
  onConvert: (id: string, type: "task" | "blog") => void;
}) {
  const { processIdea, openIdea, deferIdea, deleteIdea } = useStore();
  const [customDate, setCustomDate] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section
      className="card inbox-card"
      aria-label={idea.title || "Untitled idea"}
    >
      <div className="inbox-card-head">
        <div>
          <h2>{idea.title || "Untitled"}</h2>
          <small>
            Captured{" "}
            {new Date(idea.capturedAt || idea.createdAt).toLocaleDateString()}
            {idea.reviewAt
              ? ` · Review ${new Date(`${idea.reviewAt}T12:00:00`).toLocaleDateString()}`
              : ""}
          </small>
        </div>
        <span className="page-badge">
          {tab === "ready" ? "Needs decision" : "Deferred"}
        </span>
      </div>
      {idea.description && <p>{idea.description.slice(0, 240)}</p>}

      <div className="inbox-actions">
        <button
          className="btn btn-primary btn-sm"
          onClick={() => processIdea(idea.id)}
        >
          Process
        </button>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => openIdea(idea.id)}
        >
          Evaluate
        </button>
        <button
          className="btn btn-secondary btn-sm"
          disabled={busyId === idea.id}
          onClick={() => onConvert(idea.id, "task")}
        >
          Plan code task
        </button>
        <button
          className="btn btn-secondary btn-sm"
          disabled={busyId === idea.id}
          onClick={() => onConvert(idea.id, "blog")}
        >
          Create blog draft
        </button>
      </div>

      <div className="inbox-secondary">
        <label>
          Review later{" "}
          <select
            className="input"
            aria-label={`Defer ${idea.title}`}
            defaultValue=""
            onChange={(event) => {
              if (event.target.value) {
                deferIdea(
                  idea.id,
                  new Date(Date.now() + Number(event.target.value) * 86400000)
                    .toISOString()
                    .slice(0, 10),
                );
              }
              event.target.value = "";
            }}
          >
            <option value="">Choose date…</option>
            <option value="1">Tomorrow</option>
            <option value="7">In 7 days</option>
            <option value="30">In 30 days</option>
          </select>
        </label>
        <label>
          Custom date{" "}
          <input
            className="input"
            type="date"
            min={today}
            value={customDate}
            onChange={(e) => setCustomDate(e.target.value)}
          />
        </label>
        <button
          className="btn btn-ghost btn-sm"
          disabled={!customDate}
          onClick={() => deferIdea(idea.id, customDate)}
        >
          Set date
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => processIdea(idea.id, "archived")}
        >
          Archive
        </button>
        <button
          className={`btn btn-sm ${confirmingDelete ? "btn-danger" : "btn-ghost"}`}
          onClick={() => {
            if (confirmingDelete) deleteIdea(idea.id);
            else setConfirmingDelete(true);
          }}
          onBlur={() => setConfirmingDelete(false)}
        >
          {confirmingDelete ? "Confirm" : "Delete"}
        </button>
      </div>
    </section>
  );
}

export default function InboxPage() {
  useTitle("Inbox");
  const { ideas, setQuickCapture, processIdea } = useStore();
  const navigate = useNavigate();

  const [tab, setTab] = useState<"ready" | "deferred">("ready");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"oldest" | "newest">("oldest");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const today = new Date().toISOString().slice(0, 10);
  const inbox = ideas.filter(isInboxIdea);
  const ready = inbox.filter(
    (idea) => !idea.reviewAt || idea.reviewAt <= today,
  );
  const deferred = inbox.filter(
    (idea) => idea.reviewAt && idea.reviewAt > today,
  );

  const visible = useMemo(
    () =>
      (tab === "ready" ? ready : deferred)
        .filter((idea) =>
          `${idea.title} ${idea.description}`
            .toLowerCase()
            .includes(search.toLowerCase()),
        )
        .sort((a, b) => {
          const valA = a.capturedAt || a.createdAt;
          const valB = b.capturedAt || b.createdAt;
          return sort === "oldest"
            ? valA.localeCompare(valB)
            : valB.localeCompare(valA);
        }),
    [ready, deferred, tab, search, sort],
  );

  async function convert(id: string, type: "task" | "blog") {
    setBusyId(id);
    setError("");
    try {
      await api("/work/inbox-convert", {
        method: "POST",
        body: JSON.stringify({ ideaId: id, type }),
      });
      processIdea(id, type === "task" ? "planned" : "idea");
      navigate(`/work/${id}`);
    } catch (caught) {
      setError(String(caught));
    } finally {
      setBusyId("");
    }
  }

  return (
    <main className="work-page inbox-page">
      <div className="page-heading">
        <div>
          <h1>Inbox</h1>
          <p>Give every captured thought a next destination.</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setQuickCapture(true)}
        >
          Capture idea
        </button>
      </div>

      <div className="page-tabs" role="tablist" aria-label="Inbox view">
        <button
          role="tab"
          aria-selected={tab === "ready"}
          className={tab === "ready" ? "active" : ""}
          onClick={() => setTab("ready")}
        >
          Ready to review <span>{ready.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === "deferred"}
          className={tab === "deferred" ? "active" : ""}
          onClick={() => setTab("deferred")}
        >
          Deferred <span>{deferred.length}</span>
        </button>
      </div>

      <div className="page-toolbar">
        <input
          className="input"
          aria-label="Search Inbox"
          placeholder="Search captured ideas"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <label>
          Sort{" "}
          <select
            className="input"
            value={sort}
            onChange={(event) =>
              setSort(event.target.value as "oldest" | "newest")
            }
          >
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
          </select>
        </label>
      </div>

      {error && (
        <p role="alert" className="page-error">
          {error}
        </p>
      )}

      {!visible.length && (
        <div className="card page-empty">
          <h2>
            {search
              ? "No matching ideas"
              : tab === "ready"
                ? "All caught up"
                : "Nothing deferred"}
          </h2>
          <p>
            {search
              ? "Try another search."
              : tab === "ready"
                ? "Capture a thought or revisit deferred ideas."
                : "Deferred ideas will return on their review date."}
          </p>
        </div>
      )}

      {visible.map((idea) => (
        <InboxCard
          key={idea.id}
          idea={idea}
          tab={tab}
          busyId={busyId}
          onConvert={convert}
        />
      ))}
    </main>
  );
}
