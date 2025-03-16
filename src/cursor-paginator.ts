import {
  SelectQueryBuilder,
  ObjectType,
  ObjectLiteral,
  KeysOfAType,
} from "typeorm";

import {
  CursorPagination,
  Cursor,
  OrderBy,
  CursorTransformer,
  Nullable,
  Take,
  DirectionalCursor,
} from "./interfaces/paginator";
import { Base64Transformer } from "./transformers/base64-transformer";
import { normalizeOrderBy } from "./utils/normalizeOrderBy";

export interface CursorPaginatorParams<TEntity extends ObjectLiteral> {
  /**
   * columns to order by.
   * Caution: the set of provided columns must be unique in database,
   *  otherwise entries might be skipped/duplicated.
   */
  orderBy: OrderBy<TEntity> | OrderBy<TEntity>[];
  transformer?: CursorTransformer<TEntity> | null;
}

export interface CursorPaginatorPaginateParams {
  pageCursor?: string | null;
  limit?: number;
}

export class CursorPaginator<TEntity extends ObjectLiteral> {
  private _orders: [string, boolean][] = [];
  private _transformer: CursorTransformer<TEntity>;

  constructor(
    public readonly entity: ObjectType<TEntity>,
    { orderBy, transformer }: CursorPaginatorParams<TEntity>,
  ) {
    this._orders = normalizeOrderBy(orderBy);
    this._transformer = transformer ?? new Base64Transformer();
  }

  async paginate(
    qb: SelectQueryBuilder<TEntity>,
    params: CursorPaginatorPaginateParams = {},
    isRaw = false,
  ): Promise<CursorPagination<TEntity>> {
    const take = params.limit;

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
