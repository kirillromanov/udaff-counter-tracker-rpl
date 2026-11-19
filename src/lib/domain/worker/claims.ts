import { mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";

export interface ClaimFile {
  pid: number;
  at: string;
}

export function claimFileName(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!safe) {
    throw new Error("Claim name is empty.");
  }
  return `${safe}.lock`;
}

export function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Exclusive claim. A dead owner's file is removed once and the claim is retried. */
export async function acquireClaim(
  directory: string,
  name: string,
  options?: { alive?: (pid: number) => boolean; pid?: number },
): Promise<(() => Promise<void>) | null> {
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, claimFileName(name));
  const alive = options?.alive ?? processIsAlive;
  const pid = options?.pid ?? process.pid;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(file, "wx");
      try {
        await handle.writeFile(JSON.stringify({ pid, at: new Date().toISOString() } satisfies ClaimFile));
      } finally {
        await handle.close();
      }
      return async () => {
        await rm(file, { force: true });
      };
    } catch (error) {
      if (!isAlreadyExists(error)) {
        throw error;
      }
      const current = await readClaim(file);
      if (current && alive(current.pid)) {
        return null;
      }
      await rm(file, { force: true });
    }
  }
  return null;
}

async function readClaim(file: string): Promise<ClaimFile | null> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<ClaimFile>;
    if (typeof parsed.pid !== "number") {
      return null;
    }
    return { pid: parsed.pid, at: typeof parsed.at === "string" ? parsed.at : "" };
  } catch {
    return null;
  }
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
