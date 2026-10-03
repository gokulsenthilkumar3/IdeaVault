import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../lib/api";

type Post = {
  id: string;
  title: string;
  slug: string;
  summary: string;
  body?: string;
  coverImage: string;
  tags: string[];
  canonicalUrl?: string;
  publishedAt?: string;
};

import { useTitle } from '../hooks/useTitle';

function BlogPostCard({ item }: { item: Post }) {
  return (
    <Link to={`/blog/${item.slug}`} className="card blog-card">
      {item.coverImage && <img src={item.coverImage} alt="" loading="lazy" />}
      <div>
        <small>{item.publishedAt && new Date(item.publishedAt).toLocaleDateString()}</small>
        <h2>{item.title}</h2>
        <p>{item.summary}</p>
        <span>{item.tags.map((value) => `#${value}`).join("  ")}</span>
      </div>
    </Link>
  );
}

function BlogSubscribe() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  async function subscribe(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    try {
      const result = await api<{ message: string }>("/blog/subscribe", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setMessage(result.message);
      setEmail("");
    } catch (caught) {
      setMessage(String(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="blog-subscribe">
      <div>
        <p className="eyebrow">Stay curious</p>
        <h2>Follow new posts</h2>
        <p>One email when a new story is published. Confirm your address to subscribe.</p>
      </div>
      <form onSubmit={subscribe}>
        <input
          className="input"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          placeholder="Email address"
          aria-label="Email address"
        />
        <button className="btn btn-primary" disabled={submitting}>
          {submitting ? "Sending…" : "Subscribe"}
        </button>
      </form>
      {message && <p role="status">{message}</p>}
    </section>
  );
}

export default function BlogPage() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const tag = params.get("tag") || "";
  const [posts, setPosts] = useState<Post[]>([]);
  const [post, setPost] = useState<Post | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loadedKey, setLoadedKey] = useState('');
  const [related, setRelated] = useState<Post[]>([]);
  const requestKey = `${slug || 'index'}|${tag}`;
  const loading = slug !== 'about' && loadedKey !== requestKey;
  
  useTitle(post?.title || 'Blog');
  
  useEffect(() => {
    if (slug === "about") return;
    let cancelled = false;
    if (slug) {
      Promise.all([
        api<Post>(`/blog/public/posts/${encodeURIComponent(slug)}`),
        api<Post[]>(`/blog/public/posts/${encodeURIComponent(slug)}/related`),
      ])
        .then(([item, suggestions]) => {
          if (cancelled) return;
          setPost(item);
          setRelated(suggestions);
          setError("");
        })
        .catch(() => {
          if (cancelled) return;
          setPost(null);
          setError("Post not found or unavailable.");
        })
        .finally(() => { if (!cancelled) setLoadedKey(requestKey); });
    } else {
      api<Post[]>(`/blog/public/posts${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`)
        .then((items) => {
          if (cancelled) return;
          setPosts(items);
          setError("");
        })
        .catch(() => { if (!cancelled) setError("Blog unavailable. Please try again."); })
        .finally(() => { if (!cancelled) setLoadedKey(requestKey); });
    }
    return () => { cancelled = true; };
  }, [slug, tag, requestKey]);

  const matching = posts.filter((item) =>
    `${item.title} ${item.summary} ${item.tags.join(" ")}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  return (
    <main className="blog-public">
      <header>
        <Link to="/blog" className="gradient-text">
          Idea Vault Blog
        </Link>
        <nav aria-label="Blog navigation">
          <Link to="/blog">Stories</Link>
          <Link to="/blog/about">About</Link>
          <a href="/api/blog/rss.xml">RSS</a>
          <Link to="/dashboard">Open Vault</Link>
        </nav>
      </header>
      
      {loading && (
        <div className="page-empty" role="status">
          Loading stories…
        </div>
      )}
      
      {slug !== 'about' && !loading && error && (
        <div className="page-empty" role="alert">
          {error} <Link to="/blog">Browse all posts</Link>
        </div>
      )}
      
      {slug === "about" ? (
        <article>
          <p className="eyebrow">About</p>
          <h1>From curiosity to something real.</h1>
          <p>Ideas explored, built, and shared through Idea Vault.</p>
          <Link to="/blog">Explore the stories →</Link>
        </article>
      ) : slug ? (
        !loading && post && (
          <article className="blog-article">
            {post.coverImage && (
              <img src={post.coverImage} alt="" className="blog-cover" />
            )}
            <p className="eyebrow">
              <time dateTime={post.publishedAt}>
                {post.publishedAt &&
                  new Date(post.publishedAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
              </time>
            </p>
            <h1>{post.title}</h1>
            <p className="blog-deck">{post.summary}</p>
            <div className="blog-tags">
              {post.tags.map((item) => (
                <Link key={item} to={`/blog?tag=${encodeURIComponent(item)}`}>
                  #{item}
                </Link>
              ))}
            </div>
            <div className="prose">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {post.body || ""}
              </ReactMarkdown>
            </div>
            {related.length > 0 && (
              <aside className="blog-related">
                <h2>Read next</h2>
                <div className="blog-list">
                  {related.map((item) => (
                    <Link key={item.id} to={`/blog/${item.slug}`} className="card">
                      <h3>{item.title}</h3>
                      <p>{item.summary}</p>
                    </Link>
                  ))}
                </div>
              </aside>
            )}
          </article>
        )
      ) : (
        !loading && !error && (
          <>
            <section className="blog-hero">
              <p className="eyebrow">Stories from the vault</p>
              <h1>Ideas made real.</h1>
              <p>
                Notes, experiments, and lessons from turning a thought into something useful.
              </p>
            </section>
            
            <div className="page-toolbar">
              <input
                className="input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search posts and tags"
                aria-label="Search blog"
              />
              {tag && (
                <Link className="btn btn-secondary" to="/blog">
                  Clear #{tag}
                </Link>
              )}
            </div>
            
            {!matching.length ? (
              <div className="page-empty">
                <h2>{search ? "No matching stories" : "No stories yet"}</h2>
                <p>
                  {search ? "Try a different search." : "Published posts will appear here."}
                </p>
              </div>
            ) : (
              <div className="blog-list">
                {matching.map((item) => (
                  <BlogPostCard key={item.id} item={item} />
                ))}
              </div>
            )}
          </>
        )
      )}
      
      <BlogSubscribe />
    </main>
  );
}
