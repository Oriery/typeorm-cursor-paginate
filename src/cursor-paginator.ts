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
  prevPageCursor?: string | null;
  nextPageCursor?: string | null;
  limit?: number;
}

export class CursorPaginator<TEntity extends ObjectLiteral> {
  private _orders: [string, boolean][] = [];
  private _transformer: CursorTransformer<TEntity>;

  constructor(
    public entity: ObjectType<TEntity>,
    { orderBy, transformer }: CursorPaginatorParams<TEntity>
  ) {
    this._orders = normalizeOrderBy(orderBy);
    this._transformer = transformer ?? new Base64Transformer();
  }

  async paginate(
    qb: SelectQueryBuilder<TEntity>,
    params: CursorPaginatorPaginateParams = {},
    isRaw = false
  ): Promise<CursorPagination<TEntity>> {
    // TODO move what is possible to the constructor
    // (getting metadata, etc.)

    const take = params.limit;

    // a copy of the query builder without "limit", "where" and "order by"
    // will be used to get the total count
    const qbForCount = new SelectQueryBuilder(qb);
    
    const directionIsProvided =
      !!params.nextPageCursor || !!params.prevPageCursor;
    if (!!params.nextPageCursor && !!params.prevPageCursor) {
      throw new Error(
        "Both nextPageCursor and prevPageCursor were provided which is forbidden."
      );
    }
    // directionIsNext is true if nextPageCursor is provided or if no cursor is provided
    const directionIsNext = !!params.nextPageCursor || !directionIsProvided;
    let workingCursor: string | null = null;
    if (directionIsNext) {
      workingCursor = params.nextPageCursor ?? null;
    } else {
      workingCursor = params.prevPageCursor ?? null;
    }

    if (workingCursor) {
      this._applyWhereQuery(
        qb,
        this._parseCursor(workingCursor),
        directionIsNext
      );
    }
    for (const [key, asc] of this._orders) {
      qb.addOrderBy(
        `${qb.alias}.${key}`,
        asc === directionIsNext ? "ASC" : "DESC"
      );
    }

    let hasPageInThePrimaryDirection = false;
    const query = new SelectQueryBuilder<TEntity>(qb).take(take && take + 1);
    let [nodes, totalCount] = await Promise.all([
      isRaw ? query.getRawMany<TEntity>() : query.getMany(),
      qbForCount.getCount(),
    ]);

    if (take && nodes.length > take) {
      hasPageInThePrimaryDirection = true;
    }

    nodes = nodes.slice(0, take);
    if (!directionIsNext) {
      nodes.reverse();
    }

    return {
      totalCount,
      nodes,
      hasPrevPage: directionIsNext
        // if a cursor was provided, assume that there is a page in the direction we came from
        // TODO: fix that, do not assume
        ? (directionIsProvided && !!workingCursor)
        : hasPageInThePrimaryDirection,
      hasNextPage: directionIsNext
        ? hasPageInThePrimaryDirection
        : (directionIsProvided && !!workingCursor),
      prevPageCursor:
        nodes.length > 0
          ? this._stringifyCursor(this._createCursor(nodes[0]))
          : null,
      nextPageCursor:
        nodes.length > 0
          ? this._stringifyCursor(this._createCursor(nodes[nodes.length - 1]))
          : null,
    };
  }

  private _applyWhereQuery(
    qb: SelectQueryBuilder<TEntity>,
    cursor: Cursor<TEntity>,
    isNext: boolean
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
        `(${queryPrefix}${columnName} ${asc === isNext ? ">" : "<"} :cursor__${key})`
      );
      queryPrefix += `${columnName} = :cursor__${key} AND `;

      const column = metadata.findColumnWithPropertyPath(key);
      queryParams[`cursor__${key}`] = column
        ? qb.connection.driver.preparePersistentValue(
            cursor[key as keyof TEntity],
            column
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

  private _stringifyCursor(cursor: Cursor<TEntity>): string {
    return this._transformer.stringify(cursor);
  }

  private _parseCursor(cursorString: string): Cursor<TEntity> {
    return this._transformer.parse(cursorString);
  }
}
