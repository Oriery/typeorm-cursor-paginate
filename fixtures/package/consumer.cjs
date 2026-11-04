const assert = require("node:assert/strict");
const api = require("typeorm-cursor-paginate");
const { exercise } = require("./runtime.cjs");
const manifest = require("typeorm-cursor-paginate/package.json");
assert.equal(manifest.name, "typeorm-cursor-paginate");
assert.equal(typeof manifest.version, "string");

for (const path of [
  "lib/index.js",
  "lib/src/index.js",
  "lib/cursor-paginator.js",
  "src/index.ts",
]) {
  assert.throws(() => require(`typeorm-cursor-paginate/${path}`), {
    code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
  });
}

exercise(api).then(
  () => console.log("CommonJS public consumer passed"),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
