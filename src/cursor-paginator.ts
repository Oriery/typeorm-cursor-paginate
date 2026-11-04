import type { SelectQueryBuilder, ObjectType, ObjectLiteral } from "typeorm";
import { DriverUtils } from "typeorm/driver/DriverUtils";
import type { ColumnMetadata } from "typeorm/metadata/ColumnMetadata";
import type {
  Paginated,
  OrderBy,
  CursorTransformer,
  CursorEnvelope,
  CursorValue,
  NormalizedOrder,
} from "./interfaces/paginator";
import { PaginationInputError } from "./errors";
import { Base64Transformer } from "./transformers/base64-transformer";
import { normalizeOrderBy } from "./utils/normalizeOrderBy";
import {
  boundaryExpression,
  validateValue,
  valueColumn,
  type ValueColumn,
} from "./utils/cursorValues";

export interface CursorPaginatorParams<TEntity extends ObjectLiteral> {
  /** Include every root primary-key column; no implicit tie-breakers are appended. */
  orderBy: OrderBy<TEntity> | OrderBy<TEntity>[];
  cursorTransformer?: CursorTransformer;
}

export interface CursorPaginatorPaginateParams {
  pageCursor?: string | null;
  /** Positive safe integer. Omission explicitly means all remaining roots. */
  limit?: number;
  /** Suppress only the total count, independently of availability flags. */
  noTotalCount?: boolean;
}

interface ResolvedOrder extends NormalizedOrder, ValueColumn {
  expression: string;
  valueExpression: string;
}

const MAX_CURSOR_LENGTH = 16384;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Cursor pagination for root entities and raw root rows on SQLite and PostgreSQL. */
export class CursorPaginator<TEntity extends ObjectLiteral> {
  private readonly orders: NormalizedOrder[];
  private readonly transformer: CursorTransformer;

  constructor(
    public readonly entity: ObjectType<TEntity>,
    options: CursorPaginatorParams<TEntity>,
  ) {
    this.orders = normalizeOrderBy(options.orderBy);
    this.transformer = options.cursorTransformer ?? new Base64Transformer();
  }

  async paginate(
    qb: SelectQueryBuilder<TEntity>,
    params: CursorPaginatorPaginateParams = {},
  ): Promise<Paginated<TEntity>> {
    if (arguments.length > 2) {
      throw new PaginationInputError(
        "UNSUPPORTED_QUERY",
        "Positional raw mode was removed; use paginateRaw",
      );
    }
    return this.run<TEntity>(qb, params, false);
  }

  /** The caller declares the actual SQL projection type; column transformers are not applied. */
  async paginateRaw<TRaw extends ObjectLiteral = Record<string, unknown>>(
    qb: SelectQueryBuilder<TEntity>,
    params: CursorPaginatorPaginateParams = {},
  ): Promise<Paginated<TRaw>> {
    return this.run<TRaw>(qb, params, true);
  }

  private async run<TNode>(
    caller: SelectQueryBuilder<TEntity>,
    params: CursorPaginatorPaginateParams,
    raw: boolean,
  ): Promise<Paginated<TNode>> {
    const limit = params.limit;
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) {
      throw new PaginationInputError(
        "INVALID_LIMIT",
        "Limit must be a positive safe integer or omitted",
      );
    }
    const base = caller.clone();
    const orders = this.resolveQuery(base, raw);
    const cursor =
      params.pageCursor === undefined || params.pageCursor === null
        ? null
        : this.parseCursor(params.pageCursor, orders);
    const next = cursor?.direction !== "prev";
    const pageQuery = base.clone();
    if (cursor)
      this.addPredicate(
        pageQuery,
        this.predicate(pageQuery, orders, cursor.values, next),
      );

    // Only root columns enter the distinct key query, so to-many fan-out cannot consume a page.
    if (!raw) pageQuery.select([]).distinct(true);
    const aliases = this.addBoundaries(pageQuery, orders, !raw);
    this.orderQuery(pageQuery, orders, next);
    // MAX_SAFE_INTEGER + 1 is exactly representable; no extra item can realistically reach this bound.
    if (limit !== undefined) pageQuery.limit(limit + 1);
    const rows = await pageQuery.getRawMany<Record<string, unknown>>();
    const hasMore = limit !== undefined && rows.length > limit;
    if (hasMore) rows.pop();
    if (!next) rows.reverse();
    let values = rows.map((row) =>
      orders.map((order, i) => validateValue(row[aliases[i]], order, false)),
    );
    let nodes: TNode[];
    if (raw) {
      nodes = rows.map((row) => {
        const publicRow = { ...row };
        for (const alias of aliases) delete publicRow[alias];
        return publicRow as TNode;
      });
    } else if (rows.length) {
      const indices = base.expressionMap.mainAlias!.metadata.primaryColumns.map(
        (column) => orders.findIndex((order) => order.column === column),
      );
      const identities = values.map((tuple) =>
        indices.map((index) => tuple[index]).join("_"),
      );
      // TypeORM joins composite identity values with underscores during hydration.
      // Isolate only colliding tuples rather than merging two distinct root entities.
      const batchSize =
        new Set(identities).size === identities.length
          ? Math.max(1, Math.min(200, Math.floor(800 / indices.length)))
          : 1;
      // Bound hydration SQL even in unlimited mode (SQLite expression/parameter limits).
      const batches: CursorValue[][][] = [];
      for (let i = 0; i < values.length; i += batchSize)
        batches.push(values.slice(i, i + batchSize));
      const hydratedValues: CursorValue[][] = [];
      nodes = [];
      for (const batch of batches) {
        const hydrated = await this.hydrate<TNode>(base, orders, batch);
        nodes.push(...hydrated.nodes);
        hydratedValues.push(...hydrated.values);
      }
      values = hydratedValues;
    } else nodes = [];

    let hasPrevPage = next ? false : hasMore;
    let hasNextPage = next ? hasMore : false;
    if (values.length) {
      if (cursor) {
        const boundary = next ? values[0] : values[values.length - 1];
        const opposite = await this.exists(base, orders, boundary, !next);
        if (next) hasPrevPage = opposite;
        else hasNextPage = opposite;
      }
    } else if (cursor) {
      // Empty pages have no new boundary; the supplied tuple is an inclusive opposite bound.
      const opposite = await this.exists(
        base,
        orders,
        cursor.values,
        !next,
        true,
      );
      hasPrevPage = next && opposite;
      hasNextPage = !next && opposite;
    }
    const totalCount = params.noTotalCount
      ? null
      : await this.count(base, orders);
    return {
      totalCount,
      nodes,
      hasPrevPage,
      hasNextPage,
      prevPageCursor: values.length
        ? this.stringifyCursor(values[0], "prev")
        : null,
      nextPageCursor: values.length
        ? this.stringifyCursor(values[values.length - 1], "next")
        : null,
    };
  }

  private async hydrate<TNode>(
    base: SelectQueryBuilder<TEntity>,
    orders: ResolvedOrder[],
    tuples: CursorValue[][],
  ): Promise<{ nodes: TNode[]; values: CursorValue[][] }> {
    const hydrate = base.clone();
    const primary = orders
      .map((order, index) => ({ order, index }))
      .filter(({ order }) => order.column.isPrimary);
    const alternatives = tuples.map((tuple) =>
      primary
        .map(({ order, index }) => {
          return `${order.expression} = ${this.parameter(hydrate, tuple[index])}`;
        })
        .join(" AND "),
    );
    this.addPredicate(
      hydrate,
      `(${alternatives.map((sql) => `(${sql})`).join(" OR ")})`,
    );
    this.orderQuery(hydrate, orders, true);
    // Selecting PKs as entity columns prevents TypeORM dropping a root whose public
    // projection contains only NULL values. Remove only these private fields afterward.
    const hiddenPrimary = primary
      .map(({ order }) => order.column)
      .filter(
        (column) =>
          !hydrate.expressionMap.selects.some(
            (select) =>
              select.selection === `${hydrate.alias}.${column.propertyPath}` ||
              (select.selection === hydrate.alias && column.isSelect),
          ),
      );
    for (const column of hiddenPrimary)
      hydrate.addSelect(`${hydrate.alias}.${column.propertyPath}`);
    const hydrationAliases = this.addBoundaries(hydrate, orders, false);
    const hydrated = await hydrate.getRawAndEntities();
    for (const entity of hydrated.entities) {
      for (const column of hiddenPrimary) {
        const path = column.propertyPath.split(".");
        const ancestors: Record<string, unknown>[] = [entity];
        for (const segment of path.slice(0, -1)) {
          ancestors.push(
            ancestors[ancestors.length - 1][segment] as Record<string, unknown>,
          );
        }
        delete ancestors[ancestors.length - 1][path[path.length - 1]];
        for (let i = ancestors.length - 1; i > 0; i--) {
          if (Object.keys(ancestors[i]).length) break;
          delete ancestors[i - 1][path[i - 1]];
        }
      }
    }
    const nodes = hydrated.entities as unknown as TNode[];
    // TypeORM emits root entities in first raw-occurrence order. Keep exact boundaries from
    // those same rows, including roots that moved/disappeared between the separate reads.
    const seen = new Set<string>();
    const values: CursorValue[][] = [];
    for (const row of hydrated.raw as Record<string, unknown>[]) {
      const tuple = orders.map((order, i) =>
        validateValue(row[hydrationAliases[i]], order, false),
      );
      const identity = JSON.stringify(primary.map(({ index }) => tuple[index]));
      if (!seen.has(identity)) {
        seen.add(identity);
        values.push(tuple);
      }
    }
    if (nodes.length !== values.length) {
      throw new PaginationInputError(
        "UNSUPPORTED_QUERY",
        "Projection did not hydrate one entity per root; select at least one root column using its property path",
      );
    }
    return { nodes, values };
  }

  private async count(
    base: SelectQueryBuilder<TEntity>,
    orders: ResolvedOrder[],
  ): Promise<number> {
    // Count tuples, never delimiter-concatenated keys (which collide for composite text PKs).
    const keys = base.clone().select([]).distinct(true);
    orders
      .filter((order) => order.column.isPrimary)
      .forEach((order, index) =>
        keys.addSelect(order.expression, `pk_${index}`),
      );
    const result = await base
      .createQueryBuilder()
      .select("COUNT(*)", "total")
      .from(`(${keys.getQuery()})`, "__paginator_count")
      .setParameters(keys.getParameters())
      .getRawOne<{ total: string | number }>();
    return Number(result!.total);
  }

  private resolveQuery(
    qb: SelectQueryBuilder<TEntity>,
    raw: boolean,
  ): ResolvedOrder[] {
    const unsupported = (message: string): never => {
      throw new PaginationInputError("UNSUPPORTED_QUERY", message);
    };
    const map = qb.expressionMap;
    const alias = map.mainAlias;
    if (!alias?.hasMetadata || alias.metadata.target !== this.entity)
      unsupported(
        "Paginator entity must match the query's root entity metadata",
      );
    const metadata = alias!.metadata;
    if (
      !["postgres", "sqlite", "better-sqlite3"].includes(
        qb.connection.options.type,
      )
    ) {
      unsupported("Only PostgreSQL, sqlite and better-sqlite3 are supported");
    }
    if (
      Object.keys(map.allOrderBys).length ||
      [map.limit, map.offset, map.take, map.skip].some((v) => v !== undefined)
    ) {
      unsupported(
        "Pagination owns ORDER BY and limits; remove existing ordering, limit, take, offset and skip",
      );
    }
    if (
      map.groupBys.length ||
      map.havings.length ||
      map.selectDistinct ||
      map.selectDistinctOn.length ||
      map.commonTableExpressions.length
    ) {
      unsupported(
        "Grouped, aggregate, DISTINCT and CTE queries are not supported",
      );
    }
    if (
      map.lockMode ||
      map.cache ||
      map.relationIdAttributes.length ||
      ("relationCountAttributes" in map &&
        (map.relationCountAttributes as unknown[]).length) ||
      map.extraAppendedAndWhereCondition
    ) {
      unsupported(
        "Locks, caching and relation ID/count loaders are not supported",
      );
    }
    if (map.aliases.filter((item) => item.type === "from").length !== 1)
      unsupported("Additional FROM sources are not supported");
    for (const join of map.joinAttributes) {
      if (!join.relation || join.mapToProperty)
        unsupported("Only mapped relation joins are supported");
      if (raw && (join.relation!.isOneToMany || join.relation!.isManyToMany))
        unsupported("Raw pages support only to-one relation joins");
      if (!raw && join.isSelected && join.metadata) {
        const primary = join.metadata.primaryColumns;
        const types = primary.map((column) =>
          qb.connection.driver.normalizeType(column),
        );
        const exactIdentityTypes = [
          "int",
          "integer",
          "smallint",
          "bigint",
          "int2",
          "int4",
          "int8",
          "uuid",
          "boolean",
          "bool",
        ];
        if (
          types.some((type) =>
            [
              "timestamp",
              "timestamp without time zone",
              "timestamptz",
              "timestamp with time zone",
              "datetime",
              "date",
            ].includes(type),
          ) ||
          (primary.length > 1 &&
            types.some((type) => !exactIdentityTypes.includes(type)))
        ) {
          unsupported(
            "Selected joined entities require exact, unambiguous primary keys; temporal and delimiter-sensitive composite keys are unsupported",
          );
        }
      }
    }
    let rootSelected = false;
    const outputAliases = new Set<string>();
    const outputAlias = (name: string): void => {
      if (outputAliases.has(name))
        unsupported("Duplicate projection aliases are not supported");
      outputAliases.add(name);
    };
    for (const select of map.selects) {
      if (select.aliasName) {
        outputAlias(select.aliasName);
      }
      let found = false;
      for (const source of map.aliases) {
        if (!source.hasMetadata) continue;
        if (select.selection === source.name) {
          for (const column of source.metadata.columns.filter(
            (column) => column.isSelect,
          )) {
            outputAlias(
              DriverUtils.buildAlias(
                qb.connection.driver,
                undefined,
                source.name,
                column.databaseName,
              ),
            );
          }
          found = true;
          if (source.name === alias!.name) rootSelected = true;
          break;
        }
        const prefix = `${source.name}.`;
        if (select.selection.startsWith(prefix)) {
          const column = source.metadata.columns.find(
            (item) =>
              item.propertyPath === select.selection.slice(prefix.length) &&
              !item.isVirtualProperty,
          );
          if (column) {
            if (!select.aliasName)
              outputAlias(
                DriverUtils.buildAlias(
                  qb.connection.driver,
                  undefined,
                  source.name,
                  column.databaseName,
                ),
              );
            found = true;
            if (!raw && select.aliasName)
              unsupported(
                "Entity projections must use property paths without custom SQL aliases; use paginateRaw for aliases",
              );
            if (source.name === alias!.name) rootSelected = true;
            break;
          }
        }
      }
      if (!found)
        unsupported(
          "Select only entity aliases or direct column property paths; computed/aggregate projections are unsupported",
        );
    }
    if (!map.selects.length || (!raw && !rootSelected))
      unsupported("Entity pages must select at least one root column");
    const columns: ColumnMetadata[] = [];
    const resolved = this.orders.map((order) => {
      const column = metadata.columns.find(
        (item) =>
          item.propertyPath === order.key &&
          !item.isVirtual &&
          !item.isVirtualProperty,
      );
      if (!column)
        throw new PaginationInputError(
          "INVALID_ORDER",
          `Unknown root column property path: ${order.key}`,
        );
      columns.push(column);
      const spec = valueColumn(column, qb.connection.driver);
      const expression = `${qb.escape(qb.alias)}.${qb.escape(column.databaseName)}`;
      return {
        ...order,
        ...spec,
        expression,
        valueExpression: boundaryExpression(expression, spec),
      };
    });
    if (
      !metadata.primaryColumns.length ||
      metadata.primaryColumns.some((column) => !columns.includes(column))
    ) {
      throw new PaginationInputError(
        "INVALID_ORDER",
        "Ordering must explicitly include every root primary-key column",
      );
    }
    return resolved;
  }

  private addBoundaries(
    qb: SelectQueryBuilder<TEntity>,
    orders: ResolvedOrder[],
    native: boolean,
  ): string[] {
    const used = new Set(
      qb.expressionMap.selects.map((select) => select.aliasName),
    );
    for (const alias of qb.expressionMap.aliases) {
      if (alias.hasMetadata)
        for (const column of alias.metadata.columns)
          used.add(
            DriverUtils.buildAlias(
              qb.connection.driver,
              undefined,
              alias.name,
              column.databaseName,
            ),
          );
    }
    let index = 0;
    const fresh = (): string => {
      while (used.has(`__paginator_${index}`)) index++;
      const name = `__paginator_${index++}`;
      used.add(name);
      return name;
    };
    return orders.map((order) => {
      if (native && order.expression !== order.valueExpression)
        qb.addSelect(order.expression, fresh());
      const alias = fresh();
      qb.addSelect(order.valueExpression, alias);
      return alias;
    });
  }

  private orderQuery(
    qb: SelectQueryBuilder<TEntity>,
    orders: ResolvedOrder[],
    next: boolean,
  ): void {
    qb.orderBy();
    for (const order of orders) {
      qb.addOrderBy(
        order.expression,
        next ? order.direction : order.direction === "ASC" ? "DESC" : "ASC",
        `NULLS ${next ? order.nulls : order.nulls === "FIRST" ? "LAST" : "FIRST"}`,
      );
    }
  }

  private parameter(
    qb: SelectQueryBuilder<TEntity>,
    value: CursorValue,
  ): string {
    let i = 0;
    while (
      qb.hasParameter(`__paginator_${i}`) ||
      ("nativeParameters" in qb.expressionMap &&
        isRecord(qb.expressionMap.nativeParameters) &&
        Object.hasOwn(qb.expressionMap.nativeParameters, `__paginator_${i}`))
    )
      i++;
    const name = `__paginator_${i}`;
    // Already a database representation: preparePersistentValue would apply transformers twice.
    qb.setParameter(name, value);
    return `:${name}`;
  }

  private predicate(
    qb: SelectQueryBuilder<TEntity>,
    orders: ResolvedOrder[],
    values: CursorValue[],
    next: boolean,
    inclusive = false,
  ): string {
    const prefixes: string[] = [];
    const alternatives: string[] = [];
    orders.forEach((order, index) => {
      const value = values[index];
      const column = order.expression;
      const nullsFirst = next
        ? order.nulls === "FIRST"
        : order.nulls === "LAST";
      let compare: string;
      let equal: string;
      if (value === null) {
        compare = nullsFirst ? `${column} IS NOT NULL` : "1 = 0";
        equal = `${column} IS NULL`;
      } else {
        const parameter = this.parameter(qb, value);
        const greater = (order.direction === "ASC") === next;
        compare = `${column} ${greater ? ">" : "<"} ${parameter}`;
        if (!nullsFirst) compare = `(${compare} OR ${column} IS NULL)`;
        equal = `${column} = ${parameter}`;
      }
      alternatives.push(`(${[...prefixes, compare].join(" AND ")})`);
      prefixes.push(equal);
    });
    if (inclusive) alternatives.push(`(${prefixes.join(" AND ")})`);
    return `(${alternatives.join(" OR ")})`;
  }

  private addPredicate(
    qb: SelectQueryBuilder<TEntity>,
    predicate: string,
  ): void {
    // Preserve even unbracketed caller ORs. Only the clone's expression map is changed.
    if (qb.expressionMap.wheres.length) {
      qb.expressionMap.wheres = [
        {
          type: "simple",
          condition: {
            operator: "brackets",
            condition: qb.expressionMap.wheres,
          },
        },
      ];
    }
    qb.andWhere(predicate);
  }

  private async exists(
    base: SelectQueryBuilder<TEntity>,
    orders: ResolvedOrder[],
    values: CursorValue[],
    next: boolean,
    inclusive = false,
  ): Promise<boolean> {
    const probe = base.clone().select("1", "exists").limit(1);
    this.addPredicate(
      probe,
      this.predicate(probe, orders, values, next, inclusive),
    );
    return (await probe.getRawMany()).length > 0;
  }

  private stringifyCursor(
    values: CursorValue[],
    direction: "next" | "prev",
  ): string {
    let token: string;
    try {
      const body = this.transformer.stringify({
        version: 3,
        direction,
        order: this.orders.map((order) => ({ ...order })),
        values: [...values],
      });
      if (typeof body !== "string" || body.length === 0)
        throw new Error("Invalid serialized cursor");
      token = `v3:${body}`;
    } catch {
      throw new PaginationInputError(
        "INVALID_CURSOR",
        "Cursor transformer could not serialize the boundary",
      );
    }
    if (token.length > MAX_CURSOR_LENGTH)
      throw new PaginationInputError(
        "UNSUPPORTED_VALUE",
        "Cursor exceeds the 16384-character limit",
      );
    return token;
  }

  private parseCursor(token: string, orders: ResolvedOrder[]): CursorEnvelope {
    const invalid = (): never => {
      throw new PaginationInputError(
        "INVALID_CURSOR",
        "Invalid cursor encoding, envelope, order or boundary values",
      );
    };
    if (
      typeof token !== "string" ||
      !token.length ||
      token.length > MAX_CURSOR_LENGTH
    )
      invalid();
    if (!token.startsWith("v3:")) {
      if (/^(v\d+:|next:|prev:)/.test(token))
        throw new PaginationInputError(
          "UNSUPPORTED_CURSOR_VERSION",
          "Unsupported cursor version; restart pagination without a cursor",
        );
      invalid();
    }
    let parsed: unknown;
    try {
      parsed = this.transformer.parse(token.slice(3));
    } catch {
      invalid();
    }
    if (!isRecord(parsed)) invalid();
    const envelope = parsed as Record<string, unknown>;
    if (envelope.version !== undefined && envelope.version !== 3)
      throw new PaginationInputError(
        "UNSUPPORTED_CURSOR_VERSION",
        "Unsupported cursor version; restart pagination",
      );
    if (
      Object.keys(envelope).sort().join(",") !==
        "direction,order,values,version" ||
      envelope.version !== 3 ||
      !["next", "prev"].includes(envelope.direction as string)
    )
      invalid();
    if (
      !Array.isArray(envelope.order) ||
      envelope.order.length !== this.orders.length
    )
      invalid();
    Array.from(envelope.order as unknown[]).forEach((order, index) => {
      if (
        !isRecord(order) ||
        Object.keys(order).sort().join(",") !== "direction,key,nulls" ||
        order.key !== this.orders[index].key ||
        order.direction !== this.orders[index].direction ||
        order.nulls !== this.orders[index].nulls
      )
        invalid();
    });
    if (
      !Array.isArray(envelope.values) ||
      envelope.values.length !== orders.length
    )
      invalid();
    const values = Array.from(envelope.values as unknown[]).map(
      (value, index) => validateValue(value, orders[index], true),
    );
    return {
      version: 3,
      direction: envelope.direction as "next" | "prev",
      order: this.orders,
      values,
    };
  }
}
