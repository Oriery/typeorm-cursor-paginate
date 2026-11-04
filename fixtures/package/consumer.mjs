import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { DataSource, EntitySchema } from "typeorm";
import paginate, {
  Base64Transformer,
  CursorPaginator,
  JsonTransformer,
  PaginationInputError,
  paginate as namedPaginate,
  paginateRaw,
} from "typeorm-cursor-paginate";
import * as api from "typeorm-cursor-paginate";
import runtime from "./runtime.cjs";

const require = createRequire(import.meta.url);
const cjs = require("typeorm-cursor-paginate");
assert.equal(paginate, namedPaginate);
for (const [name, value] of Object.entries({
  Base64Transformer,
  CursorPaginator,
  JsonTransformer,
  PaginationInputError,
  paginate: namedPaginate,
  paginateRaw,
  default: paginate,
})) {
  assert.equal(value, cjs[name], `${name} must share CJS/ESM identity`);
}
assert.ok(new Base64Transformer() instanceof cjs.Base64Transformer);
assert.ok(new JsonTransformer() instanceof cjs.JsonTransformer);
assert.ok(
  new PaginationInputError("INVALID_CURSOR", "test") instanceof
    cjs.PaginationInputError,
);
assert.ok(
  new CursorPaginator(class User {}, { orderBy: { id: "ASC" } }) instanceof
    cjs.CursorPaginator,
);
for (const path of [
  "lib/index.js",
  "lib/src/index.js",
  "lib/cursor-paginator.js",
  "src/index.ts",
]) {
  await assert.rejects(import(`typeorm-cursor-paginate/${path}`), {
    code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
  });
}
await runtime.exercise(api, { DataSource, EntitySchema });
console.log("Native ESM public consumer and constructor identity passed");
