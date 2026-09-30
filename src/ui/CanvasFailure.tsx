import { isModuleLoadFailure } from "./moduleLoadFailure";

type Props = { error: Error; reset: () => void };

// A subtree retry cannot clear rejected module loaders. Offer a fresh page
// for import failures, and keep the lighter retry for other render errors.
export const CanvasFailure = ({ error, reset }: Props) => (
  <div className="overlay" style={{ zIndex: 50 }}>
    <div className="overlay-card">
      <h1>Render Glitch</h1>
      <p
        style={{
          margin: "0 0 18px",
          color: "var(--color-fg-muted)",
          fontSize: "var(--fs-md)",
          maxWidth: 360,
        }}
      >
        {isModuleLoadFailure(error)
          ? "A game module could not load. Reload to request the current files from the server."
          : "The scene could not start. Try again, or reload if the problem continues."}
      </p>
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          Reload
        </button>
        {!isModuleLoadFailure(error) && (
          <button type="button" className="btn-ghost btn--sm" onClick={reset}>
            Try again
          </button>
        )}
      </div>
      {import.meta.env.DEV && (
        <pre
          style={{
            marginTop: 16,
            padding: 12,
            textAlign: "left",
            background: "var(--color-surface-inset)",
            border: "1px solid var(--color-border-faint)",
            borderRadius: "var(--radius-md)",
            fontSize: "var(--fs-xs)",
            color: "var(--color-fg-faint)",
            maxWidth: 360,
            maxHeight: 160,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {error.message}
        </pre>
      )}
    </div>
  </div>
);
