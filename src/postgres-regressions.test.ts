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

  @Column("bigint")
  sequence!: string;

  @Column({ type: "numeric", precision: 30, scale: 12 })
  amount!: string;

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
      entities: [PageEvent, PageOwner, PageNote],
      synchronize: true,
      extra: { options: "-c timezone=Europe/Berlin" },
      logging: ["query"],
      logger: {
        logQuery: (query) => statements.push(query),
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
      const page = await paginator.paginate(qb, { limit, pageCursor: cursor });
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
      expect((await db.query("SHOW timezone"))[0].TimeZone).toBe(
        "Europe/Berlin",
      );
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
});
