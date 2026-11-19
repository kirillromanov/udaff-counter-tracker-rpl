import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("local service bind", () => {
  const script = readFileSync("scripts/dev-up.sh", "utf8");
  const service = script.split('if [[ "$MODE" == "--service" ]]')[1]?.split('if [[ "$MODE" != "--dev" ]]')[0] ?? "";
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: { start: string } };

  it("passes an explicit IPv4 loopback hostname to the supervised server", () => {
    expect(service).toContain("exec npm run start -- --hostname 127.0.0.1 --port 3000");
    expect(service).not.toMatch(/exec npm run start -- --port 3000(\s|$)/);
  });

  it("leaves the plain start script without a hostname", () => {
    expect(pkg.scripts.start).toBe("next start");
  });
});
