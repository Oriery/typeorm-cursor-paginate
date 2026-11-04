#!/usr/bin/env node
// Always test an installed tarball outside the checkout: source imports cannot verify exports.
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { basename, join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const root = resolve(__dirname, "..");
const temp = mkdtempSync(join(tmpdir(), "paginator-consumer-"));
const fixture = join(temp, "consumer");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const packageName = "typeorm-cursor-paginate";
const installed = join(fixture, "node_modules", packageName);
const publicDocuments = [
  "License",
  "README.md",
  "MIGRATION.md",
  "CHANGELOG.md",
  "docs/core-contract.md",
  "package.json",
];

function run(program, args, cwd, capture = false) {
  const result = spawnSync(program, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    env: { ...process.env, NODE_PATH: "" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${program} ${args.join(" ")} failed (${result.status})\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
  return result.stdout;
}

function installedVersion(name, directory = root) {
  return JSON.parse(
    readFileSync(join(directory, "node_modules", name, "package.json"), "utf8"),
  ).version;
}

function hash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function filesBelow(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix + entry.name;
    return entry.isDirectory()
      ? filesBelow(join(directory, entry.name), `${relative}/`)
      : [relative];
  });
}

function inspectPackage(files, expected) {
  if (expected)
    assert.deepEqual(
      [...files].sort(),
      [...expected].sort(),
      "The packed file list must match the explicit production allowlist",
    );
  for (const required of [
    ...publicDocuments,
    "lib/index.js",
    "lib/index.mjs",
    "lib/index.d.ts",
    "lib/index.d.mts",
  ]) {
    assert.ok(
      files.includes(required),
      `Missing public package file ${required}`,
    );
  }
  for (const file of files) {
    assert.ok(
      publicDocuments.includes(file) ||
        /^lib\/(?:[\w-]+\/)*[\w-]+(?:\.js|\.mjs|\.d\.ts|\.d\.mts)$/.test(file),
      `Unexpected package file ${file}`,
    );
    if (file.endsWith(".js"))
      assert.ok(
        files.includes(file.replace(/\.js$/, ".d.ts")),
        `Missing declarations for ${file}`,
      );
    if (file.endsWith(".mjs"))
      assert.ok(
        files.includes(file.replace(/\.mjs$/, ".d.mts")),
        `Missing ESM declarations for ${file}`,
      );
    if (file.endsWith(".d.ts"))
      assert.ok(
        files.includes(file.replace(/\.d\.ts$/, ".js")),
        `Missing JavaScript for ${file}`,
      );
    if (file.endsWith(".d.mts"))
      assert.ok(
        files.includes(file.replace(/\.d\.mts$/, ".mjs")),
        `Missing ESM JavaScript for ${file}`,
      );
  }
}

function writeReadmeExamples() {
  const readme = readFileSync(join(installed, "README.md"), "utf8");
  const blocks = [...readme.matchAll(/```typescript\r?\n([\s\S]*?)```/g)].map(
    (match) => match[1],
  );
  const used = new Set();
  function example(marker) {
    const matches = blocks.filter((block) => block.includes(marker));
    assert.equal(
      matches.length,
      1,
      `README must contain one executable ${marker} example`,
    );
    used.add(matches[0]);
    return matches[0];
  }
  const entity = example("async function readUsers(");
  const codec = example(
    "class JsonCursorTransformer implements CursorTransformer",
  );
  const standalone = example("const page = await paginate(User,");
  const optout = example("const forward = await paginator.paginate(");
  const raw = example("type UserRow =");
  const nullOrder = example("const byName = new CursorPaginator(");
  assert.equal(
    used.size,
    blocks.length,
    "Every README TypeScript block needs an executable fixture",
  );
  // Imports belong at module scope; preserve the executable snippet within its own block.
  const standaloneImports = standalone.match(/^import[\s\S]*?;\s*/gm) ?? [];
  const standaloneBody = standalone.replace(/^import[\s\S]*?;\s*/gm, "");
  writeFileSync(
    join(fixture, "readme.ts"),
    `${entity}\n${codec}\n${standaloneImports.join("\n")}\n
import assert from "node:assert/strict";
import { DataSource as ExampleDataSource } from "typeorm";
import { PaginationInputError as ExampleInputError } from "typeorm-cursor-paginate";

async function verifyReadme() {
  const dataSource = new ExampleDataSource({ type: "better-sqlite3", database: ":memory:", entities: [User], synchronize: true });
  await dataSource.initialize();
  try {
    await dataSource.getRepository(User).save([
      { id: 4, name: "a", ownerId: 7 }, { id: 3, name: "b", ownerId: 7 },
      { id: 2, name: "c", ownerId: 7 }, { id: 1, name: "c", ownerId: 7 },
      { id: 5, name: "hidden", ownerId: 8 },
    ]);
    const { first, second, back } = await readUsers(dataSource, 7);
    assert.deepEqual(first.nodes.map(user => user.id), [4, 3]);
    assert.deepEqual(second.nodes.map(user => user.id), [2, 1]);
    assert.deepEqual(back.nodes, first.nodes);
    assert.equal(first.totalCount, 4);
    assert.equal(second.hasNextPage, false);
    const custom = new CursorPaginator(User, { orderBy: { id: "ASC" }, cursorTransformer: new JsonCursorTransformer() });
    const query = dataSource.getRepository(User).createQueryBuilder("user").where("user.ownerId = :ownerId", { ownerId: 7 });
    {
      ${standaloneBody}
      assert.deepEqual(page.nodes.map(user => user.id), [4, 3, 2, 1]);
      assert.equal(page.totalCount, null);
    }
    {
      ${optout}
      assert.deepEqual(forward.nodes.map(user => user.id), [2, 1]);
      assert.equal(forward.totalCount, null);
      assert.equal(forward.hasPrevPage, null);
      assert.equal(forward.hasNextPage, false);
    }
    {
      ${raw}
      assert.deepEqual(page.nodes, [
        { user_id: 4, display_name: "a" }, { user_id: 3, display_name: "b" },
        { user_id: 2, display_name: "c" }, { user_id: 1, display_name: "c" },
      ]);
    }
    {
      ${nullOrder}
      const page = await byName.paginate(query, { limit: 20 });
      assert.deepEqual(page.nodes.map(user => user.id), [4, 3, 2, 1]);
    }
    const customFirst = await custom.paginate(query, { limit: 2 });
    const customSecond = await custom.paginate(query, { limit: 2, pageCursor: customFirst.nextPageCursor });
    assert.deepEqual(customFirst.nodes.map(user => user.id), [1, 2]);
    assert.deepEqual(customSecond.nodes.map(user => user.id), [3, 4]);
    await assert.rejects(custom.paginate(query, { pageCursor: "v3:[]" }), error => error instanceof ExampleInputError && error.code === "INVALID_CURSOR");
  } finally { await dataSource.destroy(); }
}
verifyReadme().then(() => console.log("All installed README TypeScript examples passed"), error => { console.error(error); process.exitCode = 1; });
`,
  );
}

function checkTypes(typescriptVersion) {
  const compiler = join(fixture, "node_modules/typescript/bin/tsc");
  const ts = require(join(fixture, "node_modules/typescript"));
  const base = {
    target: "ES2022",
    lib: ["ES2022", "ESNext.Disposable"],
    strict: true,
    esModuleInterop: true,
    skipLibCheck: false,
    experimentalDecorators: true,
    types: ["node"],
    noEmit: true,
  };
  // The same assertions must pass through both conditional declaration branches.
  for (const suffix of ["cts", "mts"]) {
    cpSync(join(fixture, "types.ts"), join(fixture, `types.${suffix}`));
  }
  for (const mode of ["NodeNext", "Node16", "Bundler", "Node10"]) {
    const compilerOptions = {
      ...base,
      module:
        mode === "Bundler" ? "ESNext" : mode === "Node10" ? "CommonJS" : mode,
      moduleResolution: mode,
    };
    if (mode === "Node10" && Number(typescriptVersion.split(".")[0]) >= 6) {
      compilerOptions.ignoreDeprecations = "6.0";
    }
    const files =
      mode === "Node10" || mode === "Bundler"
        ? ["types.ts", "readme.ts"]
        : [
            "types.cts",
            "types.mts",
            "identity.mts",
            "require-type.cts",
            "readme.ts",
          ];
    const config = `tsconfig.${mode}.json`;
    writeFileSync(
      join(fixture, config),
      JSON.stringify({ compilerOptions, files }, null, 2),
    );
    if (mode === "NodeNext" || mode === "Node16") {
      const converted = ts.convertCompilerOptionsFromJson(
        compilerOptions,
        fixture,
      );
      assert.deepEqual(converted.errors, []);
      for (const [source, resolutionMode, declaration] of [
        ["types.mts", ts.ModuleKind.ESNext, "index.d.mts"],
        ["types.cts", ts.ModuleKind.CommonJS, "index.d.ts"],
      ]) {
        const result = ts.resolveModuleName(
          packageName,
          join(fixture, source),
          converted.options,
          ts.sys,
          undefined,
          undefined,
          resolutionMode,
        );
        assert.ok(
          result.resolvedModule,
          `${mode} must resolve ${packageName} for ${source}`,
        );
        assert.equal(
          realpathSync(result.resolvedModule.resolvedFileName),
          realpathSync(join(installed, "lib", declaration)),
          `${mode} ${source} must select its intended declaration branch`,
        );
      }
    }
    run(process.execPath, [compiler, "-p", config], fixture);
    console.log(`TypeScript ${typescriptVersion}: ${mode} consumer passed`);
  }
  writeFileSync(
    join(fixture, "tsconfig.readme.json"),
    JSON.stringify(
      {
        compilerOptions: {
          ...base,
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: false,
          outDir: "readme-out",
        },
        files: ["readme.ts"],
      },
      null,
      2,
    ),
  );
  run(process.execPath, [compiler, "-p", "tsconfig.readme.json"], fixture);
  run(process.execPath, [join(fixture, "readme-out/readme.js")], fixture);
}

let success = false;
try {
  let tarball =
    process.env.PACKAGE_TARBALL && resolve(process.env.PACKAGE_TARBALL);
  let checkoutFiles;
  if (!tarball) {
    const first = JSON.parse(
      run(npm, ["pack", "--json", "--pack-destination", temp], root, true),
    )[0];
    tarball = join(temp, first.filename);
    const expected = [
      ...publicDocuments,
      ...filesBelow(join(root, "lib")).map((file) => `lib/${file}`),
    ];
    inspectPackage(
      first.files.map((file) => file.path),
      expected,
    );
    const firstHash = hash(tarball);
    const second = JSON.parse(
      run(npm, ["pack", "--json", "--pack-destination", temp], root, true),
    )[0];
    assert.equal(
      hash(join(temp, second.filename)),
      firstHash,
      "Two clean production packs must be byte-for-byte reproducible",
    );
    checkoutFiles = new Map(
      expected.map((file) => [file, hash(join(root, file))]),
    );
    console.log(
      `Reproducible package: ${first.filename}, SHA-256 ${firstHash}`,
    );
  }
  assert.ok(existsSync(tarball), `Missing tarball ${tarball}`);
  cpSync(join(root, "fixtures/package"), fixture, { recursive: true });
  writeFileSync(
    join(fixture, "package.json"),
    JSON.stringify(
      {
        name: "paginator-clean-consumer",
        version: "1.0.0",
        private: true,
        type: "commonjs",
      },
      null,
      2,
    ),
  );
  const versions = {
    typeorm: process.env.PACKAGE_TYPEORM_VERSION || installedVersion("typeorm"),
    "better-sqlite3":
      process.env.PACKAGE_SQLITE_VERSION || installedVersion("better-sqlite3"),
    typescript:
      process.env.PACKAGE_TYPESCRIPT_VERSION || installedVersion("typescript"),
    "@types/node":
      process.env.PACKAGE_NODE_TYPES_VERSION || installedVersion("@types/node"),
  };
  run(
    npm,
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--save-exact",
      "--engine-strict",
      "--strict-peer-deps",
      tarball,
      ...Object.entries(versions).map(
        ([name, version]) => `${name}@${version}`,
      ),
    ],
    fixture,
  );
  assert.ok(
    realpathSync(installed).startsWith(`${realpathSync(temp)}/`),
    "The consumer must install package files, not symlink the checkout",
  );
  const packedFiles = filesBelow(installed);
  inspectPackage(packedFiles, checkoutFiles && [...checkoutFiles.keys()]);
  if (checkoutFiles)
    for (const [file, expectedHash] of checkoutFiles) {
      assert.equal(
        hash(join(installed, file)),
        expectedHash,
        `Installed ${file} must match the newly packed checkout bytes`,
      );
    }
  const installedManifest = JSON.parse(
    readFileSync(join(installed, "package.json"), "utf8"),
  );
  assert.equal(installedManifest.name, packageName);
  console.log(
    `Testing installed artifact ${installedManifest.name}@${installedManifest.version}; SHA-256 ${hash(tarball)}`,
  );
  for (const name of Object.keys(versions))
    versions[name] = installedVersion(name, fixture);
  run(process.execPath, ["consumer.cjs"], fixture);
  run(process.execPath, ["consumer.mjs"], fixture);
  writeReadmeExamples();
  checkTypes(versions.typescript);
  console.log(
    `All packed consumers passed on ${process.version}; dependencies ${JSON.stringify(versions)}`,
  );
  if (process.env.PACKAGE_OUTPUT_DIR) {
    const output = resolve(process.env.PACKAGE_OUTPUT_DIR);
    require("node:fs").mkdirSync(output, { recursive: true });
    const destination = join(output, basename(tarball));
    cpSync(tarball, destination);
    console.log(`Verified package artifact: ${destination}`);
  }
  success = true;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (process.env.PACKAGE_KEEP_TMP === "1" || !success) {
    console.log(`Consumer fixture retained at ${temp}`);
  } else {
    rmSync(temp, { recursive: true, force: true });
  }
}
