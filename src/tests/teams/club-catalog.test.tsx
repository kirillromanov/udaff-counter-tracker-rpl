import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClubTable } from "@/app/admin/teams/club-table";
import { buildClubCatalog } from "@/lib/domain/teams/club-catalog";
import { teamKey } from "@/lib/domain/parser/normalize";

const latinX = "Динамо Мx";

describe("club catalog", () => {
  it("counts fixtures and rounds and warns on the live Latin x spelling", () => {
    expect(latinX.codePointAt(latinX.length - 1)).toBe(0x78);
    expect(teamKey(latinX)).not.toBe(teamKey("Динамо Мх"));
    const clubs = buildClubCatalog([
      { name: "Локомотив", roundNumber: 16 },
      { name: latinX, roundNumber: 16 },
      { name: "Динамо", roundNumber: 16 },
      { name: "Динамо Махачкала", roundNumber: 4 },
      { name: "Динамо Мх", roundNumber: 9 },
      { name: "Динамо Мх", roundNumber: 10 },
      { name: "динамо", roundNumber: 2 },
    ]);
    const stored = clubs.find((club) => club.name === latinX);
    expect(stored).toMatchObject({ key: teamKey(latinX), fixtureCount: 1, rounds: [16] });
    expect(stored?.warnings.join(" ")).toContain("U+0078");
    expect(stored?.warnings.join(" ")).toContain("Динамо Махачкала");
    expect(stored?.warnings.join(" ")).toContain("Динамо Мх");
    expect(stored?.warnings.join(" ")).not.toContain("Same key");
    const moscow = clubs.find((club) => club.name === "Динамо");
    expect(moscow?.warnings.join(" ")).toContain("Same key as динамо");
    expect(moscow?.warnings.join(" ")).not.toContain("Махачкала");
    const folded = clubs.find((club) => club.name === "Динамо Мх");
    expect(folded).toMatchObject({ fixtureCount: 2, rounds: [9, 10] });
  });

  it("renders the warning and a link to the club key", () => {
    const clubs = buildClubCatalog([
      { name: latinX, roundNumber: 16 },
      { name: "Локомотив", roundNumber: 16 },
    ]);
    const html = renderToStaticMarkup(<ClubTable clubs={clubs} />);
    expect(html).toContain("Latin letter inside a Cyrillic name: x (U+0078).");
    expect(html).toContain(`href="/admin/teams/spellings?key=${encodeURIComponent(teamKey(latinX))}"`);
    expect(html).toContain("Локомотив");
    expect(html).toContain(">16<");
  });
});
