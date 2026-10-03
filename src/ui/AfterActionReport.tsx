import { useTranslation } from "react-i18next";
import type { RunReport } from "../sim/runReport";
import { IconBolt } from "./MenuIcons";

export const AfterActionReport = ({ report }: { report: RunReport }) => {
  const { t } = useTranslation();

  return (
    <section
      aria-label={t("report.bolts", { count: report.boltsEarned })}
      className="flex items-center justify-center gap-3 border-t border-border py-5 mb-4 text-gold"
    >
      <span aria-hidden="true">
        <IconBolt size={34} />
      </span>
      <span className="text-3xl font-bold tabular-nums leading-none">+{report.boltsEarned}</span>
      <span className="text-base font-semibold text-fg-secondary">{t("robotShop.boltsLabel")}</span>
    </section>
  );
};
