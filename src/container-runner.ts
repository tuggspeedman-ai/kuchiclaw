// Spawns an ephemeral Docker container, passes ContainerInput via stdin,
// and captures ContainerOutput from stdout using sentinel markers.

import { spawn } from "node:child_process";
import {
  CONTAINER_IMAGE,
  CONTAINER_TIMEOUT_MS,
  OUTPUT_START_MARKER,
  OUTPUT_END_MARKER,
} from "./config.js";
import type { ContainerInput, ContainerOutput } from "./types.js";
import type { GroupPaths } from "./group-folder.js";

export async function runContainer(input: ContainerInput, paths?: GroupPaths): Promise<ContainerOutput> {
  const containerName = `kuchiclaw-${Date.now()}`;

  // Build volume mounts for living files
  const mounts: string[] = [];
  if (paths) {
    // Global files — read-only
    mounts.push("-v", `${paths.soul}:/workspace/SOUL.md:ro`);
    mounts.push("-v", `${paths.tools}:/workspace/TOOLS.md:ro`);
    // Per-group files — read-write (agent updates these)
    mounts.push("-v", `${paths.memory}:/workspace/MEMORY.md`);
    mounts.push("-v", `${paths.context}:/workspace/CONTEXT.md`);
  }

  const args = [
    "run",
    "-i",           // Keep stdin open so we can write to it
    "--rm",          // Remove container after exit
    "--name", containerName,
    ...mounts,
    CONTAINER_IMAGE,
  ];

  return new Promise<ContainerOutput>((resolve, reject) => {
    const proc = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn();
      }
    };

    // Timeout: kill container if it runs too long
    const timer = setTimeout(() => {
      settle(() => {
        proc.kill("SIGKILL");
        reject(new Error(`Container timed out after ${CONTAINER_TIMEOUT_MS}ms`));
      });
    }, CONTAINER_TIMEOUT_MS);

    proc.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      settle(() => reject(new Error(`Failed to spawn container: ${err.message}`)));
    });

    proc.on("close", (code) => {
      settle(() => {
        const output = parseOutput(stdout);
        if (output) {
          resolve(output);
        } else {
          reject(new Error(
            `Container exited with code ${code}. ` +
            `No valid output found.\nstderr: ${stderr.slice(0, 500)}\nstdout: ${stdout.slice(0, 500)}`
          ));
        }
      });
    });

    // Write ContainerInput to stdin, then close it
    proc.stdin!.write(JSON.stringify(input));
    proc.stdin!.end();
  });
}

/** Extract JSON between sentinel markers from container stdout */
function parseOutput(stdout: string): ContainerOutput | null {
  const startIdx = stdout.indexOf(OUTPUT_START_MARKER);
  const endIdx = stdout.indexOf(OUTPUT_END_MARKER);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return null;
  }

  const jsonStr = stdout.slice(startIdx + OUTPUT_START_MARKER.length, endIdx).trim();
  try {
    return JSON.parse(jsonStr) as ContainerOutput;
  } catch {
    return null;
  }
}
