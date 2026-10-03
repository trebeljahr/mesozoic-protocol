import type React from "react";
import { useTranslation } from "react-i18next";
import { MenuOverlay } from "./MenuOverlay";

type Props = {
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  confirmClassName?: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export const ConfirmationDialog = ({
  title,
  children,
  confirmLabel,
  confirmClassName = "btn-danger",
  onCancel,
  onConfirm,
}: Props) => {
  const { t } = useTranslation();
  return (
    <MenuOverlay
      title={title}
      onClose={onCancel}
      closeLabel={t("common.cancel")}
      overlayClassName="confirmation-dialog-overlay"
      cardClassName="confirmation-dialog-card"
    >
      <div className="confirmation-dialog-body">{children}</div>
      <div className="confirmation-dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button type="button" className={`btn ${confirmClassName}`} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </MenuOverlay>
  );
};
