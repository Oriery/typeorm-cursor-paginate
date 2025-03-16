import { SelectQueryBuilder, ObjectType, ObjectLiteral } from "typeorm";

import {
  CursorPagination,
  Cursor,
  OrderBy,
  CursorTransformer,
  DirectionalCursor,
} from "./interfaces/paginator";
import { Base64Transformer } from "./transformers/base64-transformer";
import { normalizeOrderBy } from "./utils/normalizeOrderBy";

export interface CursorPaginatorParams<TEntity extends ObjectLiteral> {
  /**
   * Columns to order by.
   *
   * CAUTION: the set of provided columns must be unique in database,
   *  otherwise entries might be skipped/duplicated. This rule is not enforced
   *  by the library, so be careful.
   */
  orderBy: OrderBy<TEntity> | OrderBy<TEntity>[];
  /**
   * Transformer to use for the cursor stringification and parsing.
   *
   * By default, a `Base64Transformer` is used.
   *
   * There is also a predefined `JsonTransformer` you can use.
   */
  transformer?: CursorTransformer<TEntity> | null;
}

export interface CursorPaginatorPaginateParams {
  /**
   * The cursor to the next or previous page.
   *
   * Use `prevPageCursor` or `nextPageCursor` which you got from
   * the previous page.
   */
  pageCursor?: string | null;
  /**
   * The maximum number of items to return in the current page.
   *
   * If not provided, will return all remaining items.
   */
  limit?: number;
}

/**
 * A class that implements a cursor-based pagination for TypeORM.
 *
 * @template TEntity The type of the entity that is being selected from the database.
 */
export class CursorPaginator<TEntity extends ObjectLiteral> {
  private _orders: [string, boolean][] = [];
  private _transformer: CursorTransformer<TEntity>;

  /**
   * Creates a new instance of the `CursorPaginator` class.
   *
   * @param entity The entity type to paginate.
   * @param options The options for the paginator.
   */
  constructor(
    public readonly entity: ObjectType<TEntity>,
    options: CursorPaginatorParams<TEntity>,
  ) {
    const { orderBy, transformer } = options;
    this._orders = normalizeOrderBy(orderBy);
    this._transformer = transformer ?? new Base64Transformer();
  }

  /**
   * Paginate the results of a query builder using the directional cursor.
   *
   * @param qb The query builder to paginate.
   * @param params The pagination parameters.
   * @param isRaw If true, the raw results will be returned.
   */
  async paginate(
    qb: SelectQueryBuilder<TEntity>,
    params: CursorPaginatorPaginateParams = {},
    isRaw = false,
  ): Promise<CursorPagination<TEntity>> {
    const take = params.limit;

    // limit must not be 0 or negative
    if (take !== undefined && take < 1) {
      throw new Error("Limit must be greater than 0 or undefined");
    }

    // a copy of the query builder without "limit", "where" and "order by"
    // will be used to get the total count
    const qbForCount = new SelectQueryBuilder(qb);

    // compute helper values
    const directionIsProvided = !!params.pageCursor;
    const cursorTemp: string | null = params.pageCursor || null;
    const directionalCursor = cursorTemp ? this._parseCursor(cursorTemp) : null;
    // directionIsNext is true if nextPageCursor is provided or if no cursor is provided
    const directionIsNext = directionalCursor
      ? directionalCursor.direction === "next"
      : true;

    if (directionalCursor) {
      this._applyWhereQuery(qb, directionalCursor.cursor, directionIsNext);
    }
    for (const [key, asc] of this._orders) {
      qb.addOrderBy(
        `${qb.alias}.${key}`,
        asc === directionIsNext ? "ASC" : "DESC",
      );
    }

    const query = new SelectQueryBuilder<TEntity>(qb).take(take && take + 1);
    const [nodes, totalCount] = await Promise.all([
      isRaw ? query.getRawMany<TEntity>() : query.getMany(),
      qbForCount.getCount(),
    ]);

    let hasPageInThePrimaryDirection = false;
    if (!take) {
      // no pagination
    } else if (nodes.length === take + 1) {
      // the next page exists
      hasPageInThePrimaryDirection = true;
      nodes.pop();
    } else if (nodes.length < take + 1) {
      // the next page doesn't exist
    } else {
      throw new Error(
        `Got unexpected number of nodes from executing query: ${nodes.length} . ` +
          `Expected from ${0} to ${take ? take + 1 : nodes.length}`,
      );
    }

    if (!directionIsNext) {
      nodes.reverse();
    }

    return {
      totalCount,
      nodes,
      hasPrevPage: directionIsNext
        ? // if a cursor was provided, assume that there is a page in the direction we came from
          directionIsProvided
        : hasPageInThePrimaryDirection,
      hasNextPage: directionIsNext
        ? hasPageInThePrimaryDirection
        : directionIsProvided,
      prevPageCursor:
        nodes.length > 0
          ? this._stringifyCursor(this._createCursor(nodes[0]), false)
          : null,
      nextPageCursor:
        nodes.length > 0
          ? this._stringifyCursor(
              this._createCursor(nodes[nodes.length - 1]),
              true,
            )
          : null,
    };
  }

  private _applyWhereQuery(
    qb: SelectQueryBuilder<TEntity>,
    cursor: Cursor<TEntity>,
    isNext: boolean,
  ) {
    const metadata = qb.expressionMap.mainAlias?.metadata;

    if (!metadata) {
      throw new Error("Metadata is not defined");
    }

    // TODO: would be nice to rewrite this function
    // so that instead of building a string, it builds
    // a deep object of "where" clauses.
    // Potentially, this could be more secure.

    let queryPrefix = "";
    const queryParts = [] as string[];
    const queryParams = {} as Record<string, any>;

    for (const [key, asc] of this._orders) {
      const columnName = `${qb.alias}.${key}`;
      queryParts.push(
        `(${queryPrefix}${columnName} ${asc === isNext ? ">" : "<"} :cursor__${key})`,
      );
      queryPrefix += `${columnName} = :cursor__${key} AND `;

      const column = metadata.findColumnWithPropertyPath(key);
      queryParams[`cursor__${key}`] = column
        ? qb.connection.driver.preparePersistentValue(
            cursor[key as keyof TEntity],
            column,
          )
        : cursor[key as keyof TEntity];
    }

    qb.andWhere(`(${queryParts.join(" OR ")})`, queryParams);
  }

  private _createCursor(node: TEntity): Cursor<TEntity> {
    const cursor = {} as Cursor<TEntity>;
    for (const [key, _] of this._orders) {
      cursor[key as keyof TEntity] = node[key as keyof TEntity];
    }
    return cursor;
  }

  private _stringifyCursor(
    cursor: Cursor<TEntity>,
    isForNextPage: boolean,
  ): string {
    return (
      (isForNextPage ? "next:" : "prev:") + this._transformer.stringify(cursor)
    );
  }

  private _parseCursor(cursorString: string): DirectionalCursor<TEntity> {
    let rawCursor = "";
    let isNext = false;
    if (cursorString.startsWith("next:")) {
      rawCursor = cursorString.slice(5);
      isNext = true;
    } else if (cursorString.startsWith("prev:")) {
      rawCursor = cursorString.slice(5);
    } else {
      throw new Error('Cursor string must start with "next:" or "prev:"');
    }
    const cursor = this._transformer.parse(rawCursor);

    this._validateCursor(cursor);

    return {
      cursor,
      direction: isNext ? "next" : "prev",
    };
  }

  /**
   * Checks that all properties in the cursor are in the orderBy and
   * that all properties in the orderBy are in the cursor.
   * Also checks that no property in the cursor is undefined.
   */
  private _validateCursor(cursor: Cursor<TEntity>) {
    const cursorKeys = Object.keys(cursor) as Array<keyof TEntity>;
    const orderByKeys = this._orders.map(([key, _]) => key) as Array<
      keyof TEntity
    >;

    if (cursorKeys.length !== orderByKeys.length) {
      throw new Error(`Cursor must have ${orderByKeys.length} properties`);
    }

    for (const key of cursorKeys) {
      if (!orderByKeys.includes(key)) {
        throw new Error(`Cursor has extra property ${String(key)}`);
      }
      if (cursor[key] === undefined) {
        throw new Error(`Cursor property ${String(key)} is undefined`);
      }
    }
  }
}
