import {
  Column,
  DataSource,
  Entity,
  PrimaryColumn,
  type Logger,
} from "typeorm";

import { CursorPaginator } from "./cursor-paginator";
import { JsonTransformer } from "./transformers/json-transformer";
import { paginate } from "./paginate";
import type { OrderBy } from "./interfaces/paginator";

@Entity()
class ValidationRecord {
  @PrimaryColumn({ type: "integer" })
  id!: number;

  @Column({ type: "text" })
  label!: string;

  @Column({ type: "integer", nullable: true })
  rank!: number | null;

  @Column({ type: "boolean" })
  active!: boolean;

  @Column({ type: "real" })
  score!: number;
}

@Entity()
class OtherRecord {
  @PrimaryColumn({ type: "integer" })
  id!: number;
}

const idOrder = [{ key: "id", direction: "ASC", nulls: "LAST" }];

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    version: 3,
    direction: "next",
    order: idOrder,
    values: [1],
    ...overrides,
  };
}

function token(value: unknown): string {
  return `v3:${Buffer.from(JSON.stringify(value)).toString("base64url")}`;
}

describe("v3 input validation before SQL", () => {
  let source: DataSource;
  const queries: string[] = [];
  const logger: Logger = {
    logQuery: (query) => queries.push(query),
    logQueryError: () => undefined,
    logQuerySlow: () => undefined,
    logSchemaBuild: () => undefined,
    logMigration: () => undefined,
    log: () => undefined,
  };

  beforeAll(async () => {
    source = new DataSource({
      type: "better-sqlite3",
      database: ":memory:",
      entities: [ValidationRecord, OtherRecord],
      synchronize: true,
      logging: ["query"],
      logger,
    });
    await source.initialize();
    await source.getRepository(ValidationRecord).insert([
      { id: 1, label: "alpha", rank: null, active: false, score: 1e100 },
      { id: 2, label: "beta", rank: 1, active: true, score: 2e100 },
      { id: 3, label: "gamma", rank: 1, active: true, score: 3e100 },
    ]);
  });

  beforeEach(() => {
    queries.length = 0;
  });

  afterAll(async () => {
    await source.destroy();
  });

  function query() {
    return source.getRepository(ValidationRecord).createQueryBuilder("record");
  }

  function paginator() {
    return new CursorPaginator(ValidationRecord, { orderBy: { id: "ASC" } });
  }

  async function inputError(
    action: () => unknown,
    code: string = "INVALID_CURSOR",
  ) {
    const error: unknown = await Promise.resolve()
      .then(action)
      .then(
        () => null,
        (reason: unknown) => reason,
      );
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: "PaginationInputError", code });
    expect(queries).toEqual([]);
  }

  it.each([
    ["null", null],
    ["boolean", true],
    ["number", 1],
    ["string", "cursor"],
    ["array", []],
    ["empty object", {}],
    ["extra key", envelope({ extra: true })],
    ["missing values", { version: 3, direction: "next", order: idOrder }],
    ["missing order", { version: 3, direction: "next", values: [1] }],
    ["missing direction", { version: 3, order: idOrder, values: [1] }],
    ["missing version", { direction: "next", order: idOrder, values: [1] }],
    ["bad direction", envelope({ direction: "forward" })],
    ["values as object", envelope({ values: { id: 1 } })],
    ["missing boundary key", envelope({ values: [] })],
    ["extra boundary key", envelope({ values: [1, 2] })],
    ["nested boundary", envelope({ values: [{ id: 1 }] })],
    ["array boundary", envelope({ values: [[1]] })],
    ["nonnull key", envelope({ values: [null] })],
    ["numeric string for integer", envelope({ values: ["1"] })],
    ["fraction for integer", envelope({ values: [1.5] })],
    ["boolean for integer", envelope({ values: [true] })],
    ["unsafe integer", envelope({ values: [Number.MAX_SAFE_INTEGER + 1] })],
    ["bad order shape", envelope({ order: { id: "ASC" } })],
    ["empty order", envelope({ order: [] })],
    ["different key", envelope({ order: [{ ...idOrder[0], key: "label" }] })],
    [
      "different direction",
      envelope({ order: [{ ...idOrder[0], direction: "DESC" }] }),
    ],
    [
      "different NULL placement",
      envelope({ order: [{ ...idOrder[0], nulls: "FIRST" }] }),
    ],
    [
      "extra order property",
      envelope({ order: [{ ...idOrder[0], extra: 1 }] }),
    ],
    ["duplicate order key", envelope({ order: [...idOrder, ...idOrder] })],
  ])("rejects %s envelopes without running SQL", async (_name, value) => {
    await inputError(() =>
      paginator().paginate(query(), { pageCursor: token(value) }),
    );
  });

  it.each([
    ["empty", ""],
    ["missing body", "v3:"],
    ["invalid alphabet", "v3:%%%"],
    ["padding", `${token(envelope())}=`],
    ["whitespace", `${token(envelope())}\n`],
    ["invalid JSON", `v3:${Buffer.from("{").toString("base64url")}`],
    ["invalid UTF-8", `v3:${Buffer.from([0xff]).toString("base64url")}`],
    ["oversized", `v3:${"A".repeat(16 * 1024)}`],
  ])("rejects %s encoding without running SQL", async (_name, pageCursor) => {
    await inputError(() => paginator().paginate(query(), { pageCursor }));
  });

  it.each([
    "next:eyJpZCI6MX0",
    "prev:eyJpZCI6MX0",
    "v2:eyJpZCI6MX0",
    "v4:eyJpZCI6MX0",
    token(envelope({ version: 4 })),
  ])("reports unsupported cursor version for %s", async (pageCursor) => {
    await inputError(
      () => paginator().paginate(query(), { pageCursor }),
      "UNSUPPORTED_CURSOR_VERSION",
    );
  });

  it.each([0, -1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid limit %s before running SQL",
    async (limit) => {
      await inputError(
        () => paginator().paginate(query(), { limit }),
        "INVALID_LIMIT",
      );
    },
  );

  it.each([null, "2", true, {}])("rejects runtime limit %s", async (limit) => {
    await inputError(
      () => paginator().paginate(query(), { limit: limit as number }),
      "INVALID_LIMIT",
    );
  });

  it.each([1, true, [], {}])(
    "rejects runtime cursor %s",
    async (pageCursor) => {
      await inputError(() =>
        paginator().paginate(query(), { pageCursor: pageCursor as string }),
      );
    },
  );

  it.each([
    {},
    [],
    { id: "SIDEWAYS" },
    { id: 0 },
    { id: 2 },
    { id: false },
    { id: null },
    { id: undefined },
    { id: { direction: "ASC", nulls: "MIDDLE" } },
    { id: { direction: null } },
    { id: { nulls: null } },
    { id: { direction: "ASC", extra: true } },
    [{ id: "ASC" }, { id: "DESC" }],
    { missing: "ASC", id: "ASC" },
    { "id); DROP TABLE validation_record; --": "ASC" },
    { label: "ASC" },
  ])("rejects invalid ordering %j without running SQL", async (orderBy) => {
    await inputError(
      () =>
        new CursorPaginator(ValidationRecord, {
          orderBy: orderBy as OrderBy<ValidationRecord>,
        }).paginate(query()),
      "INVALID_ORDER",
    );
  });

  it("validates the constructor entity against the query metadata", async () => {
    await inputError(
      () =>
        new CursorPaginator(OtherRecord, { orderBy: { id: "ASC" } }).paginate(
          query(),
        ),
      "UNSUPPORTED_QUERY",
    );
  });

  it("rejects the removed positional raw argument before SQL", async () => {
    const instance = paginator();
    await inputError(
      () =>
        Reflect.apply(instance.paginate.bind(instance), undefined, [
          query(),
          { limit: 1 },
          true,
        ]) as unknown,
      "UNSUPPORTED_QUERY",
    );
  });

  it("rejects the standalone removed positional raw argument before SQL", async () => {
    await inputError(
      () =>
        Reflect.apply(paginate, undefined, [
          ValidationRecord,
          query(),
          { limit: 1, orderBy: { id: "ASC" } },
          true,
        ]) as unknown,
      "UNSUPPORTED_QUERY",
    );
  });

  it("allows omitted limit as an explicit unlimited traversal", async () => {
    const page = await paginator().paginate(query());
    expect(page.nodes.map(({ id }) => id)).toEqual([1, 2, 3]);
    expect(page.hasPrevPage).toBe(false);
    expect(page.hasNextPage).toBe(false);
  });

  it("round-trips SQLite REAL values using their full double precision range", async () => {
    const real = new CursorPaginator(ValidationRecord, {
      orderBy: { score: "ASC", id: "ASC" },
    });
    let page = await real.paginate(query(), { limit: 1 });
    const forwards = page.nodes.map(({ id }) => id);
    while (page.hasNextPage) {
      page = await real.paginate(query(), {
        limit: 1,
        pageCursor: page.nextPageCursor,
      });
      forwards.push(...page.nodes.map(({ id }) => id));
      if (forwards.length > 3) throw new Error("Traversal did not end");
    }
    expect(forwards).toEqual([1, 2, 3]);
    const backwards = page.nodes.map(({ id }) => id);
    while (page.hasPrevPage) {
      page = await real.paginate(query(), {
        limit: 1,
        pageCursor: page.prevPageCursor,
      });
      backwards.unshift(...page.nodes.map(({ id }) => id));
      if (backwards.length > 3) throw new Error("Traversal did not end");
    }
    expect(backwards).toEqual([1, 2, 3]);
  });

  it("emits an order-bound versioned cursor and accepts its own output", async () => {
    const first = await paginator().paginate(query(), { limit: 1 });
    const cursor = first.nextPageCursor!;
    expect(cursor.startsWith("v3:")).toBe(true);
    const decoded: unknown = JSON.parse(
      Buffer.from(cursor.slice(3), "base64url").toString(),
    );
    expect(decoded).toEqual(envelope());
    const second = await paginator().paginate(query(), {
      limit: 1,
      pageCursor: cursor,
    });
    expect(second.nodes.map(({ id }) => id)).toEqual([2]);
  });

  it("validates a custom transformer's unknown parse result", async () => {
    const custom = new CursorPaginator(ValidationRecord, {
      orderBy: { id: "ASC" },
      cursorTransformer: {
        parse: () => ({ ...envelope(), values: [{ injected: true }] }),
        stringify: JSON.stringify,
      },
    });
    await inputError(() =>
      custom.paginate(query(), { pageCursor: "v3:custom" }),
    );
  });

  it.each([
    undefined,
    NaN,
    Infinity,
    -Infinity,
    1n,
    new Date("2020-01-01T00:00:00.000Z"),
    { value: 1 },
  ])("rejects custom-decoded non-JSON integer value %s", async (value) => {
    const custom = new CursorPaginator(ValidationRecord, {
      orderBy: { id: "ASC" },
      cursorTransformer: {
        parse: () => envelope({ values: [value] }),
        stringify: JSON.stringify,
      },
    });
    await inputError(() =>
      custom.paginate(query(), { pageCursor: "v3:custom" }),
    );
  });

  it("wraps custom parser failures in the stable input error", async () => {
    const custom = new CursorPaginator(ValidationRecord, {
      orderBy: { id: "ASC" },
      cursorTransformer: {
        parse: () => {
          throw new SyntaxError("private parser detail");
        },
        stringify: JSON.stringify,
      },
    });
    await inputError(() =>
      custom.paginate(query(), { pageCursor: "v3:custom" }),
    );
  });

  it.each([
    ["values", envelope({ values: Array.from({ length: 1 }) })],
    ["sparse values", envelope({ values: new Array<unknown>(1) })],
    ["sparse order", envelope({ order: new Array<unknown>(1) })],
  ])(
    "rejects custom-decoded %s without bypassing validation",
    async (_name, decoded) => {
      const custom = new CursorPaginator(ValidationRecord, {
        orderBy: { id: "ASC" },
        cursorTransformer: {
          parse: () => decoded,
          stringify: JSON.stringify,
        },
      });
      await inputError(() =>
        custom.paginate(query(), { pageCursor: "v3:custom" }),
      );
    },
  );

  it("supports a JSON transformer without bypassing envelope validation", async () => {
    const custom = new CursorPaginator(ValidationRecord, {
      orderBy: { id: "ASC" },
      cursorTransformer: new JsonTransformer(),
    });
    const first = await custom.paginate(query(), { limit: 1 });
    expect(first.nextPageCursor).toBe(`v3:${JSON.stringify(envelope())}`);
    const second = await custom.paginate(query(), {
      limit: 1,
      pageCursor: first.nextPageCursor,
    });
    expect(second.nodes.map(({ id }) => id)).toEqual([2]);
  });

  it("binds hostile text as a value in a composed authorization filter", async () => {
    const hostile = "'; DROP TABLE validation_record; --";
    const custom = new CursorPaginator(ValidationRecord, {
      orderBy: { label: "ASC", id: "ASC" },
    });
    const page = await custom.paginate(
      query().where("record.active = :active", { active: true }),
      {
        limit: 1,
        pageCursor: token(
          envelope({
            order: [
              { key: "label", direction: "ASC", nulls: "LAST" },
              ...idOrder,
            ],
            values: [hostile, 0],
          }),
        ),
      },
    );
    expect(page.nodes.map(({ id }) => id)).toEqual([2]);
    expect(queries.every((sql) => !sql.includes(hostile))).toBe(true);
    expect(await source.getRepository(ValidationRecord).count()).toBe(3);
  });

  it.each(["a\u0000b", "\ud800", "\udfff"])(
    "rejects text that cannot round-trip as database UTF-8: %j",
    async (label) => {
      const text = new CursorPaginator(ValidationRecord, {
        orderBy: { label: "ASC", id: "ASC" },
      });
      await inputError(() =>
        text.paginate(query(), {
          pageCursor: token(
            envelope({
              order: [
                { key: "label", direction: "ASC", nulls: "LAST" },
                ...idOrder,
              ],
              values: [label, 0],
            }),
          ),
        }),
      );
    },
  );
});
