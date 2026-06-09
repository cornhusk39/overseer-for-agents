import Link from "next/link";

// Custom 404 so a missing run or a stray URL stays inside the dashboard's
// theme. Next's default not-found page is white and looks like a crash next to
// the dark chrome.
export default function NotFound() {
  return (
    <div className="container" style={{ textAlign: "center", paddingTop: 96 }}>
      <h1 style={{ fontSize: 42, marginBottom: 8 }}>404</h1>
      <p className="dim" style={{ marginBottom: 24 }}>
        Nothing lives at this address. The run may have been pruned, or the link is stale.
      </p>
      <div className="filters" style={{ justifyContent: "center" }}>
        <Link href="/">Agents</Link>
        <Link href="/runs">Runs</Link>
        <Link href="/trends">Trends</Link>
      </div>
    </div>
  );
}
