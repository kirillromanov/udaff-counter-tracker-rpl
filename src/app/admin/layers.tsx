import { LayerStrip } from "./ui";

export function SeasonLayers({
  seasonId,
  current,
  reviewHref,
}: {
  seasonId: string;
  current?: "season" | "baseline" | "import" | "computed" | "review";
  reviewHref?: string;
}) {
  return (
    <LayerStrip
      items={[
        {
          href: `/admin/seasons/${seasonId}/standings`,
          label: "Season standings",
          detail: "Итоговая таблица. Baseline plus confirmed rounds after it.",
          current: current === "season" || current === "computed",
        },
        {
          href: `/admin/seasons/${seasonId}/checkpoint`,
          label: "Trusted baseline",
          detail: "Hand-checked table. Production standings start here.",
          current: current === "baseline",
        },
        {
          href: reviewHref ?? `/admin/seasons/${seasonId}#rounds`,
          label: "Imported parser results",
          detail: "Raw slips from the forum. Not scored yet.",
          current: current === "import",
        },
        {
          href: `/admin/seasons/${seasonId}/reconciliation`,
          label: "Unresolved review",
          detail: "Ignored users, aliases, unknown authors, and baseline gaps.",
          current: current === "review",
        },
      ]}
    />
  );
}
