import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const input = JSON.parse(readFileSync(0, "utf8"));
const unresolved = (reason) =>
  input.stop_hook_active
    ? {
        systemMessage: `${reason} Report this unresolved blocker; do not claim completion.`,
      }
    : { decision: "block", reason };
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: input.cwd ?? process.cwd(),
  encoding: "utf8",
  windowsHide: true,
}).trim();
const frameworkRoot = process.env.AI_DEV_FRAMEWORK_ROOT
  ? resolve(process.env.AI_DEV_FRAMEWORK_ROOT)
  : root;
const cli = join(frameworkRoot, "guardian", "dist", "src", "cli.js");
if (!existsSync(cli)) {
  process.stdout.write(
    `${JSON.stringify(
      unresolved(
        `ADF workflow is incomplete: Guardian CLI is unavailable at ${cli}. Build or configure AI_DEV_FRAMEWORK_ROOT, then retry.`,
      ),
    )}\n`,
  );
  process.exit(0);
}
const args = [cli, "interlock", "--root", root];
if (input.stop_hook_active) args.push("--stop-hook-active");
try {
  process.stdout.write(
    execFileSync(process.execPath, args, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    }),
  );
} catch (error) {
  process.stdout.write(
    `${JSON.stringify(
      unresolved(
        `ADF workflow is incomplete: completion interlock failed closed (${error.message}).`,
      ),
    )}\n`,
  );
}
