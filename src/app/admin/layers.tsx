import { LayerStrip } from "./ui";

export function SeasonLayers({
  seasonId,
  current,
  reviewHref,
}: {
  seasonId: string;
  current?: "baseline" | "import" | "computed" | "review";
  reviewHref?: string;
}) {
  return (
    <LayerStrip
      items={[
        {
          href: `/admin/seasons/${seasonId}/checkpoint`,
          label: "Trusted baseline",
          detail: "Hand-checked table. Scoring does not read it.",
          current: current === "baseline",
        },
        {
          href: reviewHref ?? `/admin/seasons/${seasonId}#rounds`,
          label: "Imported parser results",
          detail: "Raw slips from the forum. Not scored yet.",
          current: current === "import",
        },
        {
          href: `/admin/seasons/${seasonId}/standings`,
          label: "Computed standings",
          detail: "Written only after actual scores exist.",
          current: current === "computed",
        },
        {
          href: `/admin/seasons/${seasonId}/reconciliation`,
          label: "Unresolved review",
          detail: "Flags, aliases, and baseline gaps.",
          current: current === "review",
        },
      ]}
    />
  );
}
