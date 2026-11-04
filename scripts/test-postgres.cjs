#!/usr/bin/env node
// A supplied admin URL must allow CREATE DATABASE. Every suite uses its own database.
// Without a URL, own and remove one disposable Docker container; never reuse local data.
const { spawnSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { Client } = require("pg");

function command(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${program} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

async function main() {
  let container;
  let url = process.env.PAGINATOR_POSTGRES_URL;
  try {
    if (!url) {
      container = `paginator-test-${randomUUID()}`;
      command("docker", [
        "run",
        "--rm",
        "--detach",
        "--name",
        container,
        "--env",
        "POSTGRES_PASSWORD=paginator-test-only",
        "--publish",
        "127.0.0.1::5432",
        "postgres:18-alpine",
      ]);
      const mapping = command("docker", ["port", container, "5432/tcp"]);
      const port = mapping.split(":").at(-1);
      url = `postgres://postgres:paginator-test-only@127.0.0.1:${port}/postgres`;
    }
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const client = new Client({
        connectionString: url,
        connectionTimeoutMillis: 500,
      });
      client.on("error", () => undefined);
      try {
        await client.connect();
        ready = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      } finally {
        await client.end();
      }
    }
    if (!ready) throw new Error("PostgreSQL did not become ready");
    const result = spawnSync(
      process.execPath,
      [
        require.resolve("jest/bin/jest"),
        "src/postgres-regressions.test.ts",
        "--runInBand",
        ...process.argv.slice(2),
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          PAGINATOR_POSTGRES_URL: url,
          TZ: "America/Los_Angeles",
        },
      },
    );
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally {
    if (container) command("docker", ["rm", "--force", container]);
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
