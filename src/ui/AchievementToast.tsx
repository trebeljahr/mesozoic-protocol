import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { ACHIEVEMENT_BY_ID, type AchievementId } from "../achievements";
import { audio } from "../audio/AudioManager";
import { useGame } from "../store";

const TOAST_LIFETIME_MS = 5000;
const SWIPE_DISMISS_PX = 80;
const CLICK_DRAG_TOLERANCE_PX = 6;

type Toast = {
  id: AchievementId;
  key: number;
};

type DragStart = {
  pointerId: number;
  startX: number;
  startY: number;
  width: number;
};

type AchievementToastItemProps = {
  toast: Toast;
  onDismiss: (key: number) => void;
};

const AchievementToastItem = ({ toast, onDismiss }: AchievementToastItemProps) => {
  const { t } = useTranslation();
  const dragStartRef = useRef<DragStart | null>(null);
  const suppressClickRef = useRef(false);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const def = ACHIEVEMENT_BY_ID[toast.id];
  const Icon = def.icon;

  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const dragStart = dragStartRef.current;
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;

    const dx = event.clientX - dragStart.startX;
    const dy = event.clientY - dragStart.startY;
    const threshold = Math.min(SWIPE_DISMISS_PX, dragStart.width * 0.35);
    dragStartRef.current = null;
    setDragging(false);

    if (Math.abs(dx) >= threshold && Math.abs(dx) > Math.abs(dy) * 1.2) {
      onDismiss(toast.key);
      return;
    }

    setDragX(0);
  };

  const dragStyle: CSSProperties | undefined =
    dragging || dragX !== 0
      ? {
          transform: `translate3d(${dragX}px, 0, 0)`,
          opacity: Math.max(0.35, 1 - Math.abs(dragX) / 220),
        }
      : undefined;

  return (
    <button
      type="button"
      key={toast.key}
      className="achievement-toast"
      data-dragging={dragging ? "true" : undefined}
      onClick={(event) => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onDismiss(toast.key);
      }}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        const rect = event.currentTarget.getBoundingClientRect();
        dragStartRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          width: rect.width,
        };
        suppressClickRef.current = false;
        setDragging(true);
        setDragX(0);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const dragStart = dragStartRef.current;
        if (!dragStart || dragStart.pointerId !== event.pointerId) return;
        const dx = event.clientX - dragStart.startX;
        const dy = event.clientY - dragStart.startY;
        if (Math.hypot(dx, dy) > CLICK_DRAG_TOLERANCE_PX) suppressClickRef.current = true;
        setDragX(dx);
      }}
      onPointerUp={finishDrag}
      onPointerCancel={(event) => {
        if (dragStartRef.current?.pointerId !== event.pointerId) return;
        dragStartRef.current = null;
        setDragging(false);
        setDragX(0);
      }}
      style={dragStyle}
      title={t("common.close")}
    >
      <div className="achievement-toast-icon">
        <Icon size={40} />
      </div>
      <div className="achievement-toast-text">
        <div className="achievement-toast-label">{t("achievements.toastUnlocked")}</div>
        <div className="achievement-toast-name">{t(`achievements:${def.id}.name`)}</div>
        <div className="achievement-toast-desc">{t(`achievements:${def.id}.desc`)}</div>
      </div>
    </button>
  );
};

export const AchievementToast = () => {
  const toasts = useGame((s) => s.achievementToasts);
  const dismiss = useGame((s) => s.dismissAchievementToast);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) => setTimeout(() => dismiss(t.key), TOAST_LIFETIME_MS));
    return () => {
      for (const id of timers) clearTimeout(id);
    };
  }, [toasts, dismiss]);

  useEffect(() => {
    if (toasts.length === 0) return;
    audio.play("star", "notifications", 0.7, 120, 1.4);
  }, [toasts.length]);

  if (toasts.length === 0) return null;

  return (
    <div className="achievement-toast-stack">
      {toasts.map((t) => (
        <AchievementToastItem key={t.key} toast={t} onDismiss={dismiss} />
      ))}
    </div>
  );
};
