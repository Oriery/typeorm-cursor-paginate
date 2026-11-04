import { randomUUID } from "node:crypto";
import {
  Column,
  DataSource,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  SelectQueryBuilder,
} from "typeorm";
import { CursorPaginator } from "./cursor-paginator";
import { paginate, paginateRaw } from "./paginate";
import { OrderBy, Paginated } from "./interfaces/paginator";

@Entity("page_owner")
class PageOwner {
  @PrimaryColumn("integer")
  id!: number;

  @Column("text")
  name!: string;
}

@Entity("page_event")
class PageEvent {
  @PrimaryColumn("integer")
  id!: number;

  @Column({ type: "timestamp", precision: 6, name: "observed_at" })
  observedAt!: Date;

  @Column({ type: "timestamptz", precision: 6, name: "happened_at" })
  happenedAt!: Date;

  @Column({ type: "timestamp", precision: 6, nullable: true })
  optionalAt!: Date | null;

  @Column("bigint")
  sequence!: string;

  @Column({ type: "numeric", precision: 30, scale: 12 })
  amount!: string;

  @Column({ type: "real", default: 0 })
  reading!: number;

  @Column({ type: "text", nullable: true })
  label!: string | null;

  @Column({
    type: "integer",
    transformer: {
      to: (value: number) => value + 1000,
      from: (value: number) => value - 1000,
    },
  })
  score!: number;

  @Column("integer")
  ownerId!: number;

  @ManyToOne(() => PageOwner)
  @JoinColumn({ name: "ownerId" })
  owner!: PageOwner;

  @OneToMany(() => PageNote, (note) => note.event)
  notes!: PageNote[];

  @OneToMany(() => PageLabel, (label) => label.event)
  labels!: PageLabel[];

  displayOwner?: PageOwner | null;
}

@Entity("page_label")
class PageLabel {
  @PrimaryColumn("uuid")
  namespaceId!: string;

  @PrimaryColumn("uuid")
  objectId!: string;

  @PrimaryColumn({ type: "enum", enum: ["title", "display_name"] })
  field!: string;

  @ManyToOne(() => PageEvent, (event) => event.labels)
  @JoinColumn({ name: "eventId" })
  event!: PageEvent;

  @Column("integer")
  eventId!: number;
}

@Entity("page_note")
class PageNote {
  @PrimaryColumn("integer")
  id!: number;

  @ManyToOne(() => PageEvent, (event) => event.notes)
  @JoinColumn({ name: "eventId" })
  event!: PageEvent;

  @Column("integer")
  eventId!: number;

  @Column("text")
  text!: string;
}

const databaseUrl = process.env.PAGINATOR_POSTGRES_URL;
const postgres = databaseUrl ? describe : describe.skip;

postgres("PostgreSQL core correctness (isolated database)", () => {
  let admin: DataSource;
  let db: DataSource;
  const database = `paginator_${randomUUID().replaceAll("-", "")}`;
  const statements: string[] = [];
  const queryLog: { sql: string; parameters: unknown[] }[] = [];

  beforeAll(async () => {
    admin = await new DataSource({
      type: "postgres",
      url: databaseUrl,
    }).initialize();
    await admin.query(`CREATE DATABASE "${database}"`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${database}`;
    db = await new DataSource({
      type: "postgres",
      url: url.toString(),
      entities: [PageEvent, PageOwner, PageNote, PageLabel],
      synchronize: true,
      extra: { options: "-c timezone=Europe/Berlin" },
      logging: ["query"],
      logger: {
        logQuery: (query, parameters) => {
          statements.push(query);
          queryLog.push({
            sql: query,
            parameters: Array.isArray(parameters) ? parameters : [],
          });
        },
        logQueryError: () => undefined,
        logQuerySlow: () => undefined,
        logSchemaBuild: () => undefined,
        logMigration: () => undefined,
        log: () => undefined,
      },
    }).initialize();
  }, 30_000);

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await admin.destroy();
    }
  });

  beforeEach(async () => {
    await db.query('TRUNCATE "page_note", "page_event", "page_owner" CASCADE');
    await db.getRepository(PageOwner).save([
      { id: 1, name: "allowed" },
      { id: 2, name: "other" },
    ]);
    const rows = [
      [
        1,
        "2024-03-31 01:59:59.999999",
        "2024-03-31 00:59:59.999999+00",
        "9007199254740993",
        "123456789012345.000000000001",
        null,
      ],
      [
        2,
        "2024-03-31 03:00:00.000001",
        "2024-03-31 01:00:00.000001+00",
        "9007199254740994",
        "123456789012345.000000000002",
        "a",
      ],
      [
        3,
        "2024-03-31 03:00:00.000002",
        "2024-03-31 01:00:00.000002+00",
        "9007199254740995",
        "123456789012345.000000000003",
        "a",
      ],
      [
        4,
        "2024-03-31 03:00:00.000002",
        "2024-03-31 01:00:00.000002+00",
        "9007199254740996",
        "123456789012345.000000000004",
        null,
      ],
      [
        5,
        "2024-03-31 03:00:00.001000",
        "2024-03-31 01:00:00.001000+00",
        "9007199254740997",
        "123456789012345.000000000005",
        "b",
      ],
      [
        6,
        "2024-10-27 02:00:00.000001",
        "2024-10-27 01:00:00.000001+00",
        "9007199254740998",
        "123456789012345.000000000006",
        "z",
      ],
    ];
    for (const [id, observedAt, happenedAt, sequence, amount, label] of rows) {
      await db.query(
        'INSERT INTO "page_event" (id, observed_at, happened_at, sequence, amount, label, score, "ownerId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          id,
          observedAt,
          happenedAt,
          sequence,
          amount,
          label,
          Number(id) + 1000,
          id === 6 ? 2 : 1,
        ],
      );
    }
    await db.getRepository(PageNote).save([
      { id: 1, eventId: 1, text: "one" },
      { id: 2, eventId: 1, text: "two" },
      { id: 3, eventId: 1, text: "three" },
      { id: 4, eventId: 2, text: "four" },
    ]);
    statements.length = 0;
    queryLog.length = 0;
  });

  async function traverse(
    orderBy: OrderBy<PageEvent>,
    expected: number[],
    makeQuery: () => SelectQueryBuilder<PageEvent> = () =>
      db.getRepository(PageEvent).createQueryBuilder("e"),
    limit = 1,
  ) {
    const paginator = new CursorPaginator(PageEvent, { orderBy });
    const qb = makeQuery();
    const before = qb.getQueryAndParameters();
    const pages: Paginated<PageEvent>[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard <= expected.length; guard++) {
      const page: Paginated<PageEvent> = await paginator.paginate(qb, {
        limit,
        pageCursor: cursor,
      });
      pages.push(page);
      expect(page.totalCount).toBe(expected.length);
      if (!page.hasNextPage) break;
      cursor = page.nextPageCursor;
    }
    expect(pages.flatMap((page) => page.nodes.map((node) => node.id))).toEqual(
      expected,
    );
    const backward: number[] = pages.at(-1)!.nodes.map((node) => node.id);
    let last = pages.at(-1)!;
    for (let guard = 0; last.hasPrevPage && guard <= expected.length; guard++) {
      last = await paginator.paginate(qb, {
        limit,
        pageCursor: last.prevPageCursor,
      });
      backward.unshift(...last.nodes.map((node) => node.id));
    }
    expect(backward).toEqual(expected);
    expect(last.hasPrevPage).toBe(false);
    expect(qb.getQueryAndParameters()).toEqual(before);
    return pages;
  }

  it.each(["observedAt", "happenedAt"] as const)(
    "preserves six-digit %s boundaries across DST, timezone differences, ties and both directions",
    async (column) => {
      expect(
        (await db.query<{ TimeZone: string }[]>("SHOW timezone"))[0].TimeZone,
      ).toBe("Europe/Berlin");
      expect(process.env.TZ).toBe("America/Los_Angeles");
      const hydrated = await db
        .getRepository(PageEvent)
        .findOneByOrFail({ id: 2 });
      expect(hydrated[column]).toBeInstanceOf(Date);
      expect(hydrated[column].getMilliseconds()).toBe(0);
      await traverse({ [column]: "ASC", id: "DESC" }, [1, 2, 4, 3, 5, 6]);
      await traverse({ [column]: "DESC", id: "ASC" }, [6, 5, 3, 4, 2, 1]);
    },
  );

  it.each(["whole alias", "direct columns"])(
    "hydrates exact composite UUID/enum joined identities with %s",
    async (selection) => {
      const namespaceId = "00000000-0000-4000-8000-000000000001";
      const objectId = "00000000-0000-4000-8000-000000000002";
      await db.getRepository(PageLabel).save([
        { namespaceId, objectId, field: "title", eventId: 1 },
        { namespaceId, objectId, field: "display_name", eventId: 1 },
        { namespaceId, objectId: namespaceId, field: "title", eventId: 2 },
      ]);
      const makeQuery = () => {
        const qb = db.getRepository(PageEvent).createQueryBuilder("e");
        if (selection === "whole alias")
          qb.leftJoinAndSelect("e.labels", "label");
        else
          qb.leftJoin("e.labels", "label").addSelect([
            "label.namespaceId",
            "label.objectId",
            "label.field",
            "label.eventId",
          ]);
        return qb
          .leftJoinAndSelect("e.notes", "note")
          .leftJoinAndMapOne(
            "e.displayOwner",
            PageOwner,
            "displayOwner",
            "displayOwner.id = e.ownerId AND displayOwner.id = :visibleOwner",
            { visibleOwner: 1 },
          );
      };
      const pages = await traverse(
        { happenedAt: "ASC", id: "DESC" },
        [1, 2, 4, 3, 5, 6],
        makeQuery,
        2,
      );
      const nodes = pages.flatMap((page) => page.nodes);
      expect(nodes[0].labels.map((label) => label.field).sort()).toEqual([
        "display_name",
        "title",
      ]);
      expect(nodes[0].notes).toHaveLength(3);
      expect(nodes[1].labels).toHaveLength(1);
      expect(nodes.at(-1)!.displayOwner).toBeNull();
      expect(
        nodes.slice(0, -1).every((node) => node.displayOwner?.id === 1),
      ).toBe(true);
    },
  );

  it.each(["infinity", "-infinity", "0001-01-01 BC", "10000-01-01"])(
    "rejects unsupported stored timestamp %s rather than converting it to a different boundary",
    async (value) => {
      await db.query('UPDATE page_event SET "optionalAt" = $1 WHERE id = 1', [
        value,
      ]);
      const paginator = new CursorPaginator(PageEvent, {
        orderBy: { optionalAt: "ASC", id: "ASC" },
      });
      await expect(
        paginator.paginate(
          db.getRepository(PageEvent).createQueryBuilder("e"),
          { limit: 1 },
        ),
      ).rejects.toMatchObject({
        name: "PaginationInputError",
        code: "UNSUPPORTED_VALUE",
      });
    },
  );

  it("checks zoned timestamp year limits in UTC rather than the database timezone", async () => {
    // The session sees AD year 1 while the actual UTC instant falls in BC year 1.
    await db.query(
      "UPDATE page_event SET happened_at = '0001-01-01 00:30:00+01'::timestamptz WHERE id = 1",
    );
    const paginator = new CursorPaginator(PageEvent, {
      orderBy: { happenedAt: "ASC", id: "ASC" },
    });
    await expect(
      paginator.paginate(db.getRepository(PageEvent).createQueryBuilder("e"), {
        limit: 1,
      }),
    ).rejects.toMatchObject({
      name: "PaginationInputError",
      code: "UNSUPPORTED_VALUE",
    });
  });

  it.each(["sequence", "amount"] as const)(
    "retains exact %s database values above JavaScript number precision",
    async (column) => {
      const pages = await traverse(
        { [column]: "ASC", id: "ASC" },
        [1, 2, 3, 4, 5, 6],
      );
      expect(pages[0].nodes[0][column]).toBe(
        column === "sequence"
          ? "9007199254740993"
          : "123456789012345.000000000001",
      );
      await traverse({ [column]: "DESC", id: "ASC" }, [6, 5, 4, 3, 2, 1]);
    },
  );

  it("round-trips PostgreSQL real maximum and subnormal values in both directions", async () => {
    await db.query(`
      UPDATE page_event AS event SET reading = sample.reading
      FROM (VALUES
        (1, '-3.4028234663852886e38'::real),
        (2, '-1.401298464324817e-45'::real),
        (3, '0'::real),
        (4, '1.401298464324817e-45'::real),
        (5, '1'::real),
        (6, '3.4028234663852886e38'::real)
      ) AS sample(id, reading)
      WHERE event.id = sample.id
    `);
    await traverse({ reading: "ASC", id: "ASC" }, [1, 2, 3, 4, 5, 6]);
    await traverse({ reading: "DESC", id: "ASC" }, [6, 5, 4, 3, 2, 1]);
  });

  it.each([1e-100, -1e-100])(
    "rejects underflowing real cursor value %p before SQL",
    async (invalid) => {
      const paginator = new CursorPaginator(PageEvent, {
        orderBy: { reading: "ASC", id: "ASC" },
      });
      const qb = db.getRepository(PageEvent).createQueryBuilder("e");
      const first = await paginator.paginate(qb, { limit: 1 });
      const payload = JSON.parse(
        Buffer.from(first.nextPageCursor!.slice(3), "base64url").toString(),
      ) as { values: unknown[] };
      payload.values[0] = invalid;
      const token = `v3:${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
      statements.length = 0;
      await expect(
        paginator.paginate(qb, { limit: 1, pageCursor: token }),
      ).rejects.toMatchObject({
        name: "PaginationInputError",
        code: "INVALID_CURSOR",
      });
      expect(statements).toHaveLength(0);
    },
  );

  it("uses stored transformer values for boundaries without transforming twice", async () => {
    const pages = await traverse(
      { score: "ASC", id: "ASC" },
      [1, 2, 3, 4, 5, 6],
    );
    expect(
      pages.flatMap((page) => page.nodes.map((node) => node.score)),
    ).toEqual([1, 2, 3, 4, 5, 6]);
    await traverse({ score: "DESC", id: "ASC" }, [6, 5, 4, 3, 2, 1]);
  });

  it.each([
    ["ASC", "FIRST", [4, 1, 3, 2, 5, 6]],
    ["ASC", "LAST", [3, 2, 5, 6, 4, 1]],
    ["DESC", "FIRST", [4, 1, 6, 5, 3, 2]],
    ["DESC", "LAST", [6, 5, 3, 2, 4, 1]],
  ] as const)(
    "traverses %s NULLS %s with mixed-direction ties",
    async (direction, nulls, expected) => {
      await traverse({ label: { direction, nulls }, id: "DESC" }, [
        ...expected,
      ]);
    },
  );

  it.each([
    ["asc", [3, 2, 5, 6, 4, 1]],
    [1, [3, 2, 5, 6, 4, 1]],
    [{ direction: "asc", nulls: "last" }, [3, 2, 5, 6, 4, 1]],
    [{ nulls: "LAST" }, [3, 2, 5, 6, 4, 1]],
    ["desc", [6, 5, 3, 2, 4, 1]],
    [-1, [6, 5, 3, 2, 4, 1]],
    [{ direction: "desc", nulls: "last" }, [6, 5, 3, 2, 4, 1]],
    [{ direction: "DESC" }, [6, 5, 3, 2, 4, 1]],
  ] as const)(
    "normalizes PostgreSQL ordering form %p",
    async (direction, expected) => {
      await traverse({ label: direction, id: "DESC" }, [...expected]);
    },
  );

  it("preserves security filters and OR grouping with hostile stored strings", async () => {
    const hostile = "'; DROP TABLE page_event; --";
    await db.getRepository(PageEvent).update(2, { label: hostile });
    await traverse({ label: "ASC", id: "ASC" }, [2, 3, 5, 1, 4], () =>
      db
        .getRepository(PageEvent)
        .createQueryBuilder("e")
        .innerJoin("e.owner", "o", "o.id = :cursor__id", { cursor__id: 1 })
        .where("e.label = :hostile", { hostile })
        .orWhere("e.id IN (:...ids)", { ids: [1, 3, 4, 5, 6] }),
    );
    expect(await db.getRepository(PageEvent).count()).toBe(6);
  });

  it("keeps partial entity boundaries private and paginates complete joined entities", async () => {
    const pages = await traverse(
      { observedAt: "ASC", id: "ASC" },
      [1, 2, 3, 4, 5, 6],
      () => db.getRepository(PageEvent).createQueryBuilder("e").select("e.id"),
      2,
    );
    expect(pages.flatMap((page) => page.nodes)).toEqual(
      [1, 2, 3, 4, 5, 6].map((id) => ({ id })),
    );
    const joined = await traverse(
      { id: "ASC" },
      [1, 2, 3, 4, 5, 6],
      () =>
        db
          .getRepository(PageEvent)
          .createQueryBuilder("e")
          .leftJoinAndSelect("e.notes", "n"),
      2,
    );
    expect(joined[0].nodes[0].notes.map((note) => note.id).sort()).toEqual([
      1, 2, 3,
    ]);
  });

  it("limits to-one raw rows, maps custom aliases and does not leak boundary selections", async () => {
    const paginator = new CursorPaginator(PageEvent, {
      orderBy: { observedAt: "ASC", id: "DESC" },
    });
    const qb = db
      .getRepository(PageEvent)
      .createQueryBuilder("e")
      .innerJoin("e.owner", "o")
      .select("e.id", "event_key")
      .addSelect("o.name", "owner_name");
    const before = qb.getQueryAndParameters();
    const ids: number[] = [];
    let pageCursor: string | null = null;
    let last: Paginated<{ event_key: number; owner_name: string }>;
    do {
      last = await paginator.paginateRaw<{
        event_key: number;
        owner_name: string;
      }>(qb, { limit: 2, pageCursor });
      expect(last.nodes.length).toBeLessThanOrEqual(2);
      expect(last.totalCount).toBe(6);
      for (const row of last.nodes)
        expect(Object.keys(row).sort()).toEqual(["event_key", "owner_name"]);
      ids.push(...last.nodes.map((row) => row.event_key));
      pageCursor = last.nextPageCursor;
    } while (last.hasNextPage && ids.length <= 6);
    expect(ids).toEqual([1, 2, 4, 3, 5, 6]);
    const backward = last.nodes.map((row) => row.event_key);
    while (last.hasPrevPage && backward.length <= 6) {
      last = await paginator.paginateRaw<{
        event_key: number;
        owner_name: string;
      }>(qb, { limit: 2, pageCursor: last.prevPageCursor });
      backward.unshift(...last.nodes.map((row) => row.event_key));
    }
    expect(backward).toEqual(ids);
    expect(qb.getQueryAndParameters()).toEqual(before);
  });

  it("rejects multiplying raw joins before executing SQL", async () => {
    const paginator = new CursorPaginator(PageEvent, {
      orderBy: { id: "ASC" },
    });
    const qb = db
      .getRepository(PageEvent)
      .createQueryBuilder("e")
      .leftJoin("e.notes", "n");
    const before = statements.length;
    await expect(paginator.paginateRaw(qb, { limit: 2 })).rejects.toMatchObject(
      { name: "PaginationInputError" },
    );
    expect(statements).toHaveLength(before);
  });

  it("rejects raw aliases that overwrite automatically named root columns", async () => {
    const paginator = new CursorPaginator(PageEvent, {
      orderBy: { id: "ASC" },
    });
    const qb = db
      .getRepository(PageEvent)
      .createQueryBuilder("e")
      .innerJoin("e.owner", "o")
      .select("e")
      .addSelect("o.name", "e_id");
    statements.length = 0;
    await expect(paginator.paginateRaw(qb, { limit: 1 })).rejects.toMatchObject(
      { name: "PaginationInputError", code: "UNSUPPORTED_QUERY" },
    );
    expect(statements).toHaveLength(0);
  });

  it.each([
    ["sequence", "9223372036854775808"],
    ["sequence", "-9223372036854775809"],
    ["amount", "1234567890123456789.000000000001"],
    ["amount", "1.0000000000001"],
    ["amount", "1e1000000"],
    ["id", 2147483648],
    ["id", -2147483649],
  ] as const)(
    "rejects out-of-storage-range %s cursor value %p before SQL",
    async (column, invalid) => {
      const paginator = new CursorPaginator(PageEvent, {
        orderBy:
          column === "id" ? { id: "ASC" } : { [column]: "ASC", id: "ASC" },
      });
      const qb = db.getRepository(PageEvent).createQueryBuilder("e");
      const first = await paginator.paginate(qb, { limit: 1 });
      const payload = JSON.parse(
        Buffer.from(first.nextPageCursor!.slice(3), "base64").toString(),
      ) as { values: unknown[] };
      payload.values[0] = invalid;
      const token = `v3:${Buffer.from(JSON.stringify(payload)).toString("base64").replace(/=+$/, "")}`;
      statements.length = 0;
      await expect(
        paginator.paginate(qb, { limit: 1, pageCursor: token }),
      ).rejects.toMatchObject({ name: "PaginationInputError" });
      expect(statements).toHaveLength(0);
    },
  );

  it.each(["observedAt", "happenedAt"] as const)(
    "rejects invalid %s calendar and precision fields before SQL",
    async (column) => {
      const paginator = new CursorPaginator(PageEvent, {
        orderBy: { [column]: "ASC", id: "ASC" },
      });
      const qb = db.getRepository(PageEvent).createQueryBuilder("e");
      const first = await paginator.paginate(qb, { limit: 1 });
      const payload = JSON.parse(
        Buffer.from(first.nextPageCursor!.slice(3), "base64").toString(),
      ) as { values: unknown[] };
      const valid = payload.values[0] as string;
      const invalidValues = [
        valid.replace(/^\d{4}-\d{2}-\d{2}/, "2024-02-30"),
        valid.replace(/^\d{4}-\d{2}-\d{2}/, "2024-13-01"),
        valid.replace(/^\d{4}/, "0000"),
        valid.replace(/^\d{4}/, "10000"),
        valid.replace(/\d{2}:\d{2}:\d{2}/, "24:00:01"),
        valid.replace(/\d{2}:\d{2}:\d{2}/, "12:60:00"),
        valid.replace(/\.\d+/, ".1234567"),
        "infinity",
        "-infinity",
      ];
      if (column === "happenedAt")
        invalidValues.push(
          valid.replace(/(?:Z|[+-]\d{2}(?::?\d{2})?)$/, "+25:00"),
        );
      for (const invalid of invalidValues) {
        expect(invalid).not.toBe(valid);
        payload.values[0] = invalid;
        const token = `v3:${Buffer.from(JSON.stringify(payload)).toString("base64").replace(/=+$/, "")}`;
        statements.length = 0;
        await expect(
          paginator.paginate(qb, { limit: 1, pageCursor: token }),
        ).rejects.toMatchObject({ name: "PaginationInputError" });
        expect(statements).toHaveLength(0);
      }
    },
  );

  it("bounds page queries and measures indexed probes and joined-row fan-out", async () => {
    await db.query(`
      INSERT INTO page_event
        (id, observed_at, happened_at, sequence, amount, label, score, "ownerId")
      SELECT id, TIMESTAMP '2025-01-01', TIMESTAMPTZ '2025-01-01 00:00:00+00',
        id, id, 'bulk', id + 1000, 1
      FROM generate_series(100, 10100) AS id
    `);
    await db.query("ANALYZE page_event");
    const paginator = new CursorPaginator(PageEvent, {
      orderBy: { id: "ASC" },
    });
    const qb = db
      .getRepository(PageEvent)
      .createQueryBuilder("e")
      .leftJoinAndSelect("e.notes", "n");
    queryLog.length = 0;
    const first = await paginator.paginate(qb, { limit: 2 });
    const firstQueries = [...queryLog];
    expect(first.nodes.map((node) => node.id)).toEqual([1, 2]);
    expect(first.totalCount).toBe(10_007);
    expect(firstQueries).toHaveLength(3);
    expect(
      firstQueries.filter(({ sql }) => /COUNT\s*\(/i.test(sql)),
    ).toHaveLength(1);

    type Plan = { "Node Type": string; "Actual Rows": number; Plans?: Plan[] };
    async function explain(query: { sql: string; parameters: unknown[] }) {
      const result = await db.query<{ "QUERY PLAN": { Plan: Plan }[] }[]>(
        `EXPLAIN (ANALYZE, FORMAT JSON) ${query.sql}`,
        query.parameters,
      );
      return result[0]["QUERY PLAN"][0].Plan;
    }
    const pageQuery = firstQueries.find(({ sql }) => /LIMIT 3\b/.test(sql));
    const hydrationQuery = firstQueries.find(
      ({ sql }) => !/LIMIT|COUNT\s*\(/i.test(sql),
    );
    expect(pageQuery).toBeDefined();
    expect(hydrationQuery).toBeDefined();
    expect((await explain(pageQuery!))["Actual Rows"]).toBe(3);
    expect((await explain(hydrationQuery!))["Actual Rows"]).toBe(4);
    expect(first.nodes[0].notes).toHaveLength(3);
    expect(first.nodes[1].notes).toHaveLength(1);

    queryLog.length = 0;
    const second = await paginator.paginate(qb, {
      limit: 2,
      pageCursor: first.nextPageCursor,
      noTotalCount: true,
    });
    const secondQueries = [...queryLog];
    expect(second.nodes.map((node) => node.id)).toEqual([3, 4]);
    expect(second.totalCount).toBeNull();
    expect(second.hasPrevPage).toBe(true);
    expect(second.hasNextPage).toBe(true);
    expect(secondQueries).toHaveLength(3);
    expect(secondQueries.some(({ sql }) => /COUNT\s*\(/i.test(sql))).toBe(
      false,
    );
    const probe = secondQueries.find(({ sql }) => /LIMIT 1\b/.test(sql));
    expect(probe).toBeDefined();
    const plan = await explain(probe!);
    function nodes(node: Plan): Plan[] {
      return [node, ...(node.Plans ?? []).flatMap(nodes)];
    }
    expect(plan["Actual Rows"]).toBe(1);
    expect(nodes(plan).some((node) => /Index/.test(node["Node Type"]))).toBe(
      true,
    );

    const rawQuery = db
      .getRepository(PageEvent)
      .createQueryBuilder("e")
      .select("e.id", "id");
    queryLog.length = 0;
    const firstRaw = await paginator.paginateRaw<{ id: number }>(rawQuery, {
      limit: 2,
    });
    expect(queryLog).toHaveLength(2);
    queryLog.length = 0;
    const secondRaw = await paginator.paginateRaw<{ id: number }>(rawQuery, {
      limit: 2,
      pageCursor: firstRaw.nextPageCursor,
      noTotalCount: true,
    });
    expect(secondRaw.nodes.map((node) => node.id)).toEqual([3, 4]);
    expect(secondRaw.totalCount).toBeNull();
    expect(queryLog).toHaveLength(2);
    expect(queryLog.some(({ sql }) => /COUNT\s*\(/i.test(sql))).toBe(false);
  });

  it("skips only the opposite entity probe while preserving default boolean types", async () => {
    const paginator = new CursorPaginator(PageEvent, {
      orderBy: { id: "ASC" },
    });
    const qb = db
      .getRepository(PageEvent)
      .createQueryBuilder("e")
      .leftJoinAndSelect("e.notes", "note");
    const original = qb.getQueryAndParameters();
    const requireBoolean = (value: boolean) => value;
    const requireNull = (value: null) => value;

    queryLog.length = 0;
    const first = await paginator.paginate(qb, {
      limit: 2,
      noTotalCount: true,
    });
    expect(requireBoolean(first.hasPrevPage)).toBe(false);
    expect(requireBoolean(first.hasNextPage)).toBe(true);
    // @ts-expect-error Default-mode availability remains boolean, not null.
    expect(requireNull(first.hasPrevPage)).toBe(false);
    expect(queryLog).toHaveLength(2);

    queryLog.length = 0;
    const skipped = await paginator.paginate(qb, {
      limit: 2,
      pageCursor: first.nextPageCursor,
      noTotalCount: true,
      noOppositePageCheck: true,
    });
    expect(skipped.nodes.map((node) => node.id)).toEqual([3, 4]);
    // @ts-expect-error An opt-out result cannot promise a boolean opposite flag.
    expect(requireBoolean(skipped.hasPrevPage)).toBeNull();
    expect(skipped.hasNextPage).toBe(true);
    expect(skipped.totalCount).toBeNull();
    expect(queryLog).toHaveLength(2);
    expect(queryLog.some(({ sql }) => /LIMIT 1\b/.test(sql))).toBe(false);
    expect(queryLog.some(({ sql }) => /COUNT\s*\(/i.test(sql))).toBe(false);

    queryLog.length = 0;
    const checked = await paginator.paginate(qb, {
      limit: 2,
      pageCursor: first.nextPageCursor,
      noTotalCount: true,
      noOppositePageCheck: false,
    });
    expect(requireBoolean(checked.hasPrevPage)).toBe(true);
    expect(requireBoolean(checked.hasNextPage)).toBe(true);
    expect(checked.nodes).toEqual(skipped.nodes);
    expect(checked.prevPageCursor).toBe(skipped.prevPageCursor);
    expect(checked.nextPageCursor).toBe(skipped.nextPageCursor);
    expect(queryLog).toHaveLength(3);
    expect(qb.getQueryAndParameters()).toEqual(original);
  });

  it("keeps raw projections typed and totals independent of optional opposite checks", async () => {
    const paginator = new CursorPaginator(PageEvent, {
      orderBy: { id: "ASC" },
    });
    const qb = db
      .getRepository(PageEvent)
      .createQueryBuilder("e")
      .leftJoin("e.owner", "owner")
      .select("e.id", "eventId");
    const first = await paginator.paginateRaw<{ eventId: number }>(qb, {
      limit: 2,
      noOppositePageCheck: true,
      noTotalCount: true,
    });
    expect(first.hasPrevPage).toBe(false);
    expect(first.hasNextPage).toBe(true);

    queryLog.length = 0;
    const second = await paginateRaw<{ eventId: number }>(PageEvent, qb, {
      orderBy: { id: "ASC" },
      limit: 2,
      pageCursor: first.nextPageCursor,
      noOppositePageCheck: true,
    });
    const rowId: number = second.nodes[0].eventId;
    expect(rowId).toBe(3);
    // @ts-expect-error The explicit raw result type must not widen to ObjectLiteral/any.
    expect(second.nodes[0].unselectedColumn).toBeUndefined();
    expect(second.nodes).toEqual([{ eventId: 3 }, { eventId: 4 }]);
    expect(second.totalCount).toBe(6);
    expect(second.hasPrevPage).toBeNull();
    expect(second.hasNextPage).toBe(true);
    const requireBoolean = (value: boolean) => value;
    // @ts-expect-error Explicit raw output generics must not erase nullable flags.
    expect(requireBoolean(second.hasPrevPage)).toBeNull();
    expect(queryLog).toHaveLength(2);
    expect(queryLog.filter(({ sql }) => /COUNT\s*\(/i.test(sql))).toHaveLength(
      1,
    );
    expect(queryLog.some(({ sql }) => /LIMIT 1\b/.test(sql))).toBe(false);

    queryLog.length = 0;
    const backward = await paginator.paginateRaw<{ eventId: number }>(qb, {
      limit: 2,
      pageCursor: second.prevPageCursor,
      noOppositePageCheck: true,
      noTotalCount: true,
    });
    expect(backward.nodes).toEqual(first.nodes);
    expect(backward.hasPrevPage).toBe(false);
    // @ts-expect-error Explicit instance raw generics retain nullable availability.
    expect(requireBoolean(backward.hasNextPage)).toBeNull();
    expect(queryLog).toHaveLength(1);
    expect(queryLog.some(({ sql }) => /LIMIT 1\b|COUNT\s*\(/i.test(sql))).toBe(
      false,
    );
  });

  it("returns unknown opposite availability on empty PostgreSQL cursor pages without a probe", async () => {
    const paginator = new CursorPaginator(PageEvent, {
      orderBy: { id: "ASC" },
    });
    const qb = db.getRepository(PageEvent).createQueryBuilder("e");
    const all = await paginator.paginate(qb, { noTotalCount: true });
    for (const [pageCursor, hasPrevPage, hasNextPage] of [
      [all.nextPageCursor, null, false],
      [all.prevPageCursor, false, null],
    ] as const) {
      queryLog.length = 0;
      const empty = await paginator.paginate(qb, {
        limit: 2,
        pageCursor,
        noOppositePageCheck: true,
        noTotalCount: true,
      });
      expect(empty).toEqual({
        nodes: [],
        totalCount: null,
        hasPrevPage,
        hasNextPage,
        prevPageCursor: null,
        nextPageCursor: null,
      });
      expect(queryLog).toHaveLength(1);
      expect(queryLog.some(({ sql }) => /LIMIT 1\b/.test(sql))).toBe(false);
    }
  });

  it("types standalone defaults as boolean and dynamic options as nullable", async () => {
    const qb = db.getRepository(PageEvent).createQueryBuilder("e");
    const requireBoolean = (value: boolean) => value;
    const first = await paginate(PageEvent, qb, {
      orderBy: { id: "ASC" },
      limit: 2,
      noTotalCount: true,
    });
    expect(requireBoolean(first.hasPrevPage)).toBe(false);
    expect(requireBoolean(first.hasNextPage)).toBe(true);
    const rawQuery = qb.clone().select("e.id", "eventId");
    const raw = await paginateRaw<{ eventId: number }>(PageEvent, rawQuery, {
      orderBy: { id: "ASC" },
      limit: 2,
      noTotalCount: true,
      noOppositePageCheck: false,
    });
    expect(requireBoolean(raw.hasPrevPage)).toBe(false);
    expect(requireBoolean(raw.hasNextPage)).toBe(true);

    const fetch = (noOppositePageCheck: boolean) =>
      paginate(PageEvent, qb, {
        orderBy: { id: "ASC" },
        limit: 2,
        pageCursor: first.nextPageCursor,
        noTotalCount: true,
        noOppositePageCheck,
      });
    queryLog.length = 0;
    const dynamic = await fetch(true);
    // @ts-expect-error Dynamic configuration can disable the opposite check.
    expect(requireBoolean(dynamic.hasPrevPage)).toBeNull();
    expect(dynamic.hasNextPage).toBe(true);
    expect(queryLog).toHaveLength(2);
  });
});
