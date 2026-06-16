// Debug-only HTML overlay listing the per-wave plan emitted by
// scripts/wave-optimal-path.ts (--emit-traces). Sister to PlannerOverlay
// (the 3D ghost-tower projection) — this panel exposes the timing wiring
// the ghosts can't show: which upgrades land on which wave, suggested
// robot, per-wave reqDPS vs achieved. isDebug gates the whole thing so
// production strips it.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { showDebugOverlays } from "../debug";
import { fetchPlannerTrace, type PlannerTrace, type PlannerWaveAction } from "../debugPlannerTrace";
import { useGame } from "../store";

const fmtLane = (vs: number[]) => vs.map((v) => Math.round(v)).join("/");
const fmtLanes = (l: number[]) => (l.length === 1 ? `L${l[0]}` : `L${l.join("+")}`);

const describeAction = (a: PlannerWaveAction): string => {
  if (a.type === "build")
    return `+${a.kind}@${fmtLanes(a.lanes)} (${Math.round(a.anchor.x)},${Math.round(a.anchor.y)}) ${a.cost}g`;
  return `↑${a.kind} ${a.branch.toUpperCase()}→T${a.tier} ${a.cost}g`;
};

export const PlannerHud = () => {
  if (!showDebugOverlays) return null;
  return <PlannerHudInner />;
};

const PlannerHudInner = () => {
  const { t } = useTranslation();
  const levelId = useGame((s) => s.world.levelId);
  const difficulty = useGame((s) => s.progress.difficulty);
  const [trace, setTrace] = useState<PlannerTrace | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setTrace(null);
    fetchPlannerTrace(levelId, difficulty)
      .then((t) => {
        if (!cancelled) setTrace(t);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [levelId, difficulty]);

  if (!trace) return null;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        title={t("planner.showHint")}
        style={{
          position: "fixed",
          top: "calc(16px + var(--safe-top, 0px))",
          right: "calc(104px + var(--safe-right, 0px))",
          zIndex: 12,
          width: 46,
          height: 34,
          background: "rgba(8,12,18,0.78)",
          color: "#ffd66a",
          border: "1px solid rgba(255,214,106,0.42)",
          borderRadius: 6,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0,
          cursor: "pointer",
          pointerEvents: "auto",
        }}
      >
        {t("planner.tag")}
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        top: "calc(76px + var(--safe-top, 0px))",
        right: "calc(12px + var(--safe-right, 0px))",
        zIndex: 50,
        maxWidth: 360,
        maxHeight:
          "min(58vh, calc(100vh - 104px - var(--safe-top, 0px) - var(--safe-bottom, 0px)))",
        overflow: "auto",
        background: "rgba(8,12,18,0.88)",
        color: "#cfe5ff",
        border: "1px solid rgba(255,214,106,0.4)",
        borderRadius: 6,
        padding: "8px 10px",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        lineHeight: 1.35,
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 6,
          color: "#ffd66a",
          fontWeight: 700,
          letterSpacing: "0.06em",
        }}
      >
        <span>
          {t("planner.tag")} · {trace.levelName}
        </span>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          style={{
            background: "transparent",
            color: "#ffd66a",
            border: "1px solid rgba(255,214,106,0.4)",
            borderRadius: 4,
            padding: "0 6px",
            cursor: "pointer",
          }}
        >
          {collapsed ? "+" : "−"}
        </button>
      </div>
      <div style={{ color: "#9fd8ff", marginBottom: 6 }}>
        {trace.difficulty} · safety {trace.safety}× · beam {trace.beamWidth} · startGold{" "}
        {trace.effectiveStartGold}
      </div>
      <div style={{ marginBottom: 6 }}>
        <span style={{ color: "#ffd66a" }}>{t("planner.robot")}</span> {trace.suggestedRobot}
        <div style={{ color: "#7da3c2", fontSize: 10 }}>{trace.suggestedRobotReason}</div>
      </div>
      <div
        style={{
          marginBottom: 6,
          color: trace.success ? "#7be3a4" : "#ff7a8c",
        }}
      >
        {trace.success
          ? `${t("planner.cleared")} · ${trace.totalSpent}g · ${trace.finalPortfolio}`
          : `${t("planner.infeasible", { wave: trace.failedAt })} · ${trace.totalSpent}g · ${trace.finalPortfolio}`}
      </div>
      {!collapsed &&
        trace.waves.map((w) => (
          <div
            key={w.wave}
            style={{
              borderTop: "1px dashed rgba(255,214,106,0.18)",
              paddingTop: 4,
              marginTop: 4,
            }}
          >
            <div style={{ color: w.cleared ? "#7be3a4" : "#ff7a8c" }}>
              W{w.wave} · {w.archetype} · req {fmtLane(w.reqDpsByLane)} → got{" "}
              {fmtLane(w.dpsAfterByLane)} · {w.goldIn}→{w.goldOut}g
            </div>
            {w.actions.length === 0 ? (
              <div style={{ color: "#7da3c2" }}> {t("planner.noActions")}</div>
            ) : (
              w.actions.map((a) => (
                <div
                  key={`${a.type}-${a.towerId}-${describeAction(a)}`}
                  style={{ color: "#cfe5ff" }}
                >
                  {"  "}
                  {describeAction(a)}
                </div>
              ))
            )}
          </div>
        ))}
    </div>
  );
};
