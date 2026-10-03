import { useMemo, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Lightbulb, TrendingUp, CheckCircle, Flame, ArrowRight, Zap, PenTool, LayoutTemplate, Send, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useStore } from '../stores/useStore';
import { computeAnalytics } from '../lib/storage';
import { STATUS_COLORS, STATUS_LABELS, PRIORITY_COLORS, PRIORITY_LABELS, PRIORITY_WEIGHT } from '../types';
import { isExecutionIdea, isInboxIdea, isStaleIdea, scoreIdea, scoreLabel } from '../lib/ideaLogic';
import type { Status } from '../types';
import styles from './Dashboard.module.css';
import { api } from '../lib/api';

type Overview = { failedChecks: { id: string; ideaId: string; name: string; url: string }[]; recentPosts: { id: string; ideaId: string; title: string; slug: string }[]; blockedTasks: { id: string; ideaId: string; title: string }[] };

import { useTitle } from '../hooks/useTitle';

function OnboardingView({ handleNewIdea, handleQuickCapture }: { handleNewIdea: () => void; handleQuickCapture: (title: string, templateId?: string) => void }) {
  return (
    <div className={styles.page}>
      <div className={styles.onboardingHero}>
        <h1 className={styles.heading}>
          Welcome to <span className="gradient-text">Idea Vault</span>
        </h1>
        <p className={styles.onboardingSub}>
          Your central hub to capture thoughts, prioritize problems, and ship products.
        </p>
        <button className="btn btn-primary btn-lg" onClick={handleNewIdea} style={{ marginTop: 16 }}>
          <Zap size={18} /> Capture an Idea
        </button>
      </div>

      <div className={styles.onboardingSection}>
        <h2 className={styles.sectionHeader} style={{ marginBottom: 16, fontSize: 14 }}>
          Quick Capture Templates
        </h2>
        <div className={styles.quickTemplatesGrid}>
          <button className={styles.quickTemplateCard} onClick={() => handleQuickCapture('Product Idea', 'product')}>
            <Lightbulb size={20} color="#7c5cff" />
            <div className={styles.quickTemplateContent}>
              <h3>Product idea</h3>
              <p>A completely new product or app concept</p>
            </div>
          </button>
          <button className={styles.quickTemplateCard} onClick={() => handleQuickCapture('Feature Request', 'feature')}>
            <PenTool size={20} color="#60a5fa" />
            <div className={styles.quickTemplateContent}>
              <h3>Feature request</h3>
              <p>Enhancement for an existing product</p>
            </div>
          </button>
          <button className={styles.quickTemplateCard} onClick={() => handleQuickCapture('Problem to solve', 'problem')}>
            <LayoutTemplate size={20} color="#f59e0b" />
            <div className={styles.quickTemplateContent}>
              <h3>Problem to solve</h3>
              <p>Identify a friction point to tackle</p>
            </div>
          </button>
          <button className={styles.quickTemplateCard} onClick={() => handleQuickCapture('Content idea', 'content')}>
            <Send size={20} color="#34d399" />
            <div className={styles.quickTemplateContent}>
              <h3>Content idea</h3>
              <p>Blog post, video, or social content</p>
            </div>
          </button>
        </div>
      </div>
      
      <div className={styles.onboardingSteps}>
        <div className={styles.onboardingStep}>
          <div className={styles.stepNum}>1</div>
          <h4>Capture</h4>
          <p>Jot down ideas immediately. Don't worry about formatting.</p>
        </div>
        <div className={styles.onboardingStep}>
          <div className={styles.stepNum}>2</div>
          <h4>Organize</h4>
          <p>Add tags, set priority, and flesh out the details when ready.</p>
        </div>
        <div className={styles.onboardingStep}>
          <div className={styles.stepNum}>3</div>
          <h4>Build</h4>
          <p>Move ideas to "Building" and focus on shipping.</p>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  useTitle('Dashboard');
  const { ideas, tags, createIdea, openIdea, setFilter, setQuickCapture, processIdea, completeNextAction } = useStore();
  const navigate = useNavigate();
  const [overview, setOverview] = useState<Overview>({ failedChecks: [], recentPosts: [], blockedTasks: [] });
  useEffect(() => { api<Overview>('/work/overview').then(setOverview).catch(() => {}); }, []);

  const analytics = useMemo(() => computeAnalytics(ideas), [ideas]);
  const totalActive = useMemo(() => ideas.filter((i) => !i.deletedAt).length, [ideas]);

  const recentIdeas = useMemo(
    () =>
      ideas
        .filter((i) => !i.deletedAt)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 5),
    [ideas]
  );

  const reviewQueue = useMemo(() => {
    return ideas.filter(i => {
      if (i.deletedAt) return false;
      if (i.status === 'building') return true;
      if (i.priority === 'high' && i.status === 'planned') return true;
      if (i.tagIds.length === 0) return true;
      if (isStaleIdea(i)) return true;
      return false;
    }).sort((a,b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority] || b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);
  }, [ideas]);

  const tagUsage = useMemo(
    () =>
      tags
        .map((tag) => ({
          ...tag,
          count: ideas.filter((i) => !i.deletedAt && i.tagIds.includes(tag.id)).length,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    [tags, ideas]
  );

  const thirtyDay = useMemo(() => {
    const now = new Date();
    const result: { date: string; count: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000).toISOString().split('T')[0];
      result.push({ date: d, count: ideas.filter((idea) => !idea.deletedAt && idea.createdAt.startsWith(d)).length });
    }
    return result;
  }, [ideas]);

  const max30 = Math.max(...thirtyDay.map((v) => v.count), 1);
  const inboxList = useMemo(() => ideas.filter(isInboxIdea), [ideas]);
  const inboxIdeas = useMemo(() => inboxList.slice(0, 5), [inboxList]);
  const topOpportunities = ideas.filter((i) => !i.deletedAt && i.evaluation).sort((a, b) => scoreIdea(b.evaluation) - scoreIdea(a.evaluation)).slice(0, 5);
  const executionIdeas = ideas.filter(isExecutionIdea).sort((a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]).slice(0, 5);
  const staleIdeas = ideas.filter((i) => isStaleIdea(i)).slice(0, 5);

  function handleNewIdea() {
    setQuickCapture(true);
  }

  function goToStatus(status: string) {
    setFilter('status', [status as any]);
    navigate('/ideas');
  }

  function handleQuickCapture(title: string, templateId?: string) {
    const idea = createIdea({ title, template: templateId });
    openIdea(idea.id);
  }

  if (analytics.total === 0) {
    return <OnboardingView handleNewIdea={handleNewIdea} handleQuickCapture={handleQuickCapture} />;
  }

  return (
    <div className={styles.page}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.heading}>
            <span className="gradient-text">Idea Vault</span>
          </h1>
          <p className={styles.subheading}>
            {analytics.total} idea{analytics.total !== 1 ? 's' : ''} in your vault.
            {analytics.created7d > 0 && ` You captured ${analytics.created7d} ideas this week.`}
          </p>
        </div>
        <button className="btn btn-primary" onClick={handleNewIdea}>
          <Plus size={15} /> New Idea
        </button>
      </div>

      {/* ── Stats row ───────────────────────────────────────────────────── */}
      <div className={styles.stats}>
        <StatCard
          icon={<Lightbulb size={18} />}
          label="Total Ideas"
          value={analytics.total}
          accent="#7c5cff"
          onClick={() => navigate('/ideas')}
        />
        <StatCard
          icon={<TrendingUp size={18} />}
          label="Created This Week"
          value={analytics.created7d}
          accent="#60a5fa"
          onClick={() => navigate('/ideas')}
        />
        <StatCard
          icon={<CheckCircle size={18} />}
          label="Done This Week"
          value={analytics.doneThisWeek}
          accent="#34d399"
          onClick={() => goToStatus('done')}
        />
        <StatCard
          icon={<Flame size={18} />}
          label="Day Streak"
          value={analytics.streak}
          suffix={analytics.streak === 1 ? 'day' : 'days'}
          accent="#f59e0b"
          title="Consecutive days where you created or updated an idea"
        />
      </div>

      <div className={styles.chartsGrid}>
        <ActionCard title={`Inbox · ${inboxList.length}`} items={inboxIdeas} empty="No unprocessed captures." render={(idea) => (
          <><span className={styles.recentTitle}>{idea.title || 'Untitled'}</span><button className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); processIdea(idea.id); }}>Process</button></>
        )} onOpen={openIdea} />
        <ActionCard title="Execution queue" items={executionIdeas} empty="Nothing planned or building." render={(idea) => (
          <><span className={styles.recentTitle}>{idea.title || 'Untitled'} · {idea.nextAction || 'Set next action'}</span>{idea.nextAction && <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); completeNextAction(idea.id); }}>Complete action</button>}</>
        )} onOpen={openIdea} />
      </div>

      <div className={styles.chartsGrid}>
        <ActionCard title="Top opportunities" items={topOpportunities} empty="Evaluate ideas to rank them." render={(idea) => <><span className={styles.recentTitle}>{idea.title || 'Untitled'}</span><span className="badge badge-accent">{scoreIdea(idea.evaluation)} · {scoreLabel(scoreIdea(idea.evaluation))}</span></>} onOpen={openIdea} />
        <ActionCard title="Needs a decision" items={staleIdeas} empty="No stale ideas. Nice work." render={(idea) => <><span className={styles.recentTitle}>{idea.title || 'Untitled'}</span><span className="badge">30d+ stale</span></>} onOpen={openIdea} />
      </div>
      <div className={styles.chartsGrid}>
        <div className={`card ${styles.recentCard}`}><div className={styles.sectionHeader}><span>Blocked work & failed checks</span></div>{overview.blockedTasks.map((task) => <button key={task.id} className="btn btn-ghost btn-sm" onClick={() => navigate(`/work/${task.ideaId}`)}>Blocked: {task.title}</button>)}{overview.failedChecks.map((check) => <a key={check.id} href={check.url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">Failed: {check.name}</a>)}{!overview.blockedTasks.length && !overview.failedChecks.length && <p>Nothing blocked.</p>}</div>
        <div className={`card ${styles.recentCard}`}><div className={styles.sectionHeader}><span>Recent publications</span></div>{overview.recentPosts.map((post) => <button key={post.id} className="btn btn-ghost btn-sm" onClick={() => navigate(`/blog/${post.slug}`)}>{post.title}</button>)}{!overview.recentPosts.length && <p>No posts published yet.</p>}</div>
      </div>

      {/* ── Actionable Work ─────────────────────────────────────────────── */}
      <div className={styles.chartsGrid}>
        {/* Review Queue */}
        <div className={`card ${styles.recentCard}`}>
          <div className={styles.sectionHeader}>
            <span><Zap size={14} /> Review Queue</span>
          </div>
          {reviewQueue.length === 0 ? (
            <div className="empty-state" style={{ padding: 'var(--s4)' }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Inbox zero! All caught up.</span>
            </div>
          ) : (
            <div className={styles.reviewList}>
              {reviewQueue.map((idea) => {
                const isBuilding = idea.status === 'building';
                const isStale = isStaleIdea(idea);
                return (
                  <div key={idea.id} className={styles.reviewItem} onClick={() => openIdea(idea.id)}>
                    <div className={styles.reviewMain}>
                      <span className={styles.recentTitle}>{idea.title || 'Untitled'}</span>
                      {isBuilding ? (
                        <span className="badge badge-accent">Building</span>
                      ) : idea.priority === 'high' ? (
                        <span className="badge" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }}>High Priority</span>
                      ) : idea.tagIds.length === 0 ? (
                        <span className="badge">Untagged</span>
                      ) : isStale ? (
                        <span className="badge">Stale (30d+)</span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Ideas */}
        <div className={`card ${styles.recentCard}`}>
          <div className={styles.sectionHeader}>
            <span><Clock size={14} /> Recent Ideas</span>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/ideas')}>
              See all <ArrowRight size={12} />
            </button>
          </div>
          {recentIdeas.length === 0 ? (
            <div className="empty-state" style={{ padding: 'var(--s4)' }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>No ideas yet.</span>
            </div>
          ) : (
            <div className={styles.reviewList}>
              {recentIdeas.map((idea) => (
                <div key={idea.id} className={styles.reviewItem} onClick={() => openIdea(idea.id)}>
                  <div className={styles.reviewMain}>
                    <span className={styles.recentTitle}>{idea.title || 'Untitled'}</span>
                    <span className={styles.recentTime}>{formatDistanceToNow(new Date(idea.updatedAt))} ago</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Analytics Grid ────────────────────────────────────────────────── */}
      <div className={styles.chartsGrid}>
        {/* Status distribution */}
        <div className={`card ${styles.chartCard}`}>
          <div className={styles.sectionHeader}>
            <span>Status Distribution</span>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/ideas')}>
              View all <ArrowRight size={12} />
            </button>
          </div>
          <div className={styles.donutWrap}>
            <div className={styles.donutLegend}>
              {(['idea', 'planned', 'building', 'done', 'archived'] as const).map((status) => {
                const count = analytics.byStatus[status];
                const pct = totalActive > 0 ? ((count / totalActive) * 100).toFixed(1) : '0.0';
                return (
                  <div
                    key={status}
                    className={styles.legendRow}
                    onClick={() => goToStatus(status)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') goToStatus(status); }}
                  >
                    <span className={styles.legendDot} style={{ background: STATUS_COLORS[status as Status] }} />
                    <span className={styles.legendLabel}>{STATUS_LABELS[status as Status]}</span>
                    <div className={styles.legendBar}>
                      <div
                        className={styles.legendBarFill}
                        style={{ width: `${pct}%`, background: STATUS_COLORS[status as Status] }}
                      />
                    </div>
                    <span className={styles.legendCount}>{count}</span>
                    <span className={styles.legendPct}>{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Priority breakdown & Top Tags */}
        <div className={`card ${styles.chartCard}`}>
          <div className={styles.sectionHeader}>
            <span>Priority Breakdown</span>
          </div>
          <div className={styles.donutLegend}>
            {(['high', 'medium', 'low'] as const).map((p) => {
              const count = analytics.byPriority[p];
              const pct = totalActive > 0 ? ((count / totalActive) * 100).toFixed(1) : '0.0';
              return (
                <div key={p} className={styles.legendRow}>
                  <span className={styles.legendDot} style={{ background: PRIORITY_COLORS[p] }} />
                  <span className={styles.legendLabel}>{PRIORITY_LABELS[p]}</span>
                  <div className={styles.legendBar}>
                    <div
                      className={styles.legendBarFill}
                      style={{ width: `${pct}%`, background: PRIORITY_COLORS[p] }}
                    />
                  </div>
                  <span className={styles.legendCount}>{count}</span>
                  <span className={styles.legendPct}>{pct}%</span>
                </div>
              );
            })}
          </div>

          {tagUsage.length > 0 && (
            <>
              <div className={styles.sectionHeader} style={{ marginTop: 24 }}>
                <span>Top Tags</span>
                <button className="btn btn-ghost btn-sm" onClick={() => navigate('/tags')}>
                  All <ArrowRight size={12} />
                </button>
              </div>
              <div className={styles.tagUsageList}>
                {tagUsage.map((tag) => (
                  <div key={tag.id} className={styles.tagUsageRow}>
                    <span className={styles.tagUsageDot} style={{ background: tag.color }} />
                    <span className={styles.tagUsageName}>{tag.name}</span>
                    <div className={styles.legendBar}>
                      <div
                        className={styles.legendBarFill}
                        style={{
                          width: tagUsage[0].count > 0 ? `${(tag.count / tagUsage[0].count) * 100}%` : '0%',
                          background: tag.color,
                        }}
                      />
                    </div>
                    <span className={styles.legendCount}>{tag.count}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 30-day bar chart */}
      <div className={`card ${styles.bigChartCard}`}>
        <div className={styles.sectionHeader}>
          <span>30-Day Creation Trend</span>
        </div>
        <div className={styles.bigChart}>
          {thirtyDay.map((v, i) => {
            const height = max30 > 0 ? (v.count / max30) * 100 : 0;
            const isToday = v.date === new Date().toISOString().split('T')[0];
            const showLabel = i === 0 || i === 14 || i === 29 || i % 7 === 0;
            return (
              <div key={i} className={styles.bigBarWrap} title={`${v.date}: ${v.count} ideas`}>
                <span className={styles.bigBarCount}>{v.count > 0 ? v.count : ''}</span>
                <div
                  className={styles.bigBar}
                  style={{
                    height: `${Math.max(height, v.count > 0 ? 5 : 0)}%`,
                    background: isToday ? 'var(--accent)' : 'var(--accent-dim)',
                    border: isToday ? '1px solid var(--accent-border)' : 'none',
                  }}
                />
                {showLabel && (
                  <span className={styles.bigBarLabel}>
                    {new Date(v.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>


    </div>
  );
}

function ActionCard({ title, items, empty, render, onOpen }: { title: string; items: any[]; empty: string; render: (idea: any) => React.ReactNode; onOpen: (id: string) => void }) {
  return <div className={`card ${styles.recentCard}`}>
    <div className={styles.sectionHeader}><span>{title}</span></div>
    {items.length === 0 ? <div className="empty-state" style={{ padding: 'var(--s4)' }}><span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{empty}</span></div> : <div className={styles.reviewList}>{items.map((idea) => <div key={idea.id} className={styles.reviewItem} role="button" tabIndex={0} aria-label={`Open ${idea.title || 'Untitled idea'}`} onClick={() => onOpen(idea.id)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onOpen(idea.id); } }}><div className={styles.reviewMain}>{render(idea)}</div></div>)}</div>}
  </div>;
}

function StatCard({
  icon, label, value, accent, suffix, onClick, title
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent: string;
  suffix?: string;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <div
      className={`card ${styles.statCard} ${onClick ? styles.statCardClickable : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => { if (onClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick(); } }}
      title={title}
    >
      <div className={styles.statIcon} style={{ background: accent + '22', color: accent }}>
        {icon}
      </div>
      <div className={styles.statValue}>{value}{suffix ? ` ${suffix}` : ''}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}
