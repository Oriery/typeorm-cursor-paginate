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

    const qbForCount = new SelectQueryBuilder(qb);

    // TODO combine implementations for 2 directions
    if (params.prevPageCursor) {
      this._applyWhereQuery(
        qb,
        this._parseCursor(params.prevPageCursor),
        false,
      );
      for (const [key, value] of this._orders) {
        qb.addOrderBy(`${qb.alias}.${key}`, value ? "DESC" : "ASC");
      }

      let hasPrevPage = false;
      const query = take ? new SelectQueryBuilder(qb).take(take + 1) : new SelectQueryBuilder(qb);
      const nodes = await (isRaw ? query.getRawMany() : query.getMany()).then(
        (nodes) => {
          if (take && nodes.length > take) {
            hasPrevPage = true;
          }
          return nodes.slice(0, take).reverse();
        },
      );

      return {
        totalCount: await qbForCount.getCount(),
        nodes,
        hasPrevPage,
        hasNextPage: true,
        prevPageCursor:
          nodes.length > 0
            ? this._stringifyCursor(this._createCursor(nodes[0]))
            : null,
        nextPageCursor:
          nodes.length > 0
            ? this._stringifyCursor(
                this._createCursor(nodes[nodes.length - 1]),
              )
            : null,
      };
    }

    if (params.nextPageCursor) {
      this._applyWhereQuery(
        qb,
        this._parseCursor(params.nextPageCursor),
        true,
      );
    }
    for (const [key, value] of this._orders) {
      qb.addOrderBy(`${qb.alias}.${key}`, value ? "ASC" : "DESC");
    }

    let hasNextPage = false;
    const query = take ? new SelectQueryBuilder(qb).take(take + 1) : new SelectQueryBuilder(qb);
    const nodes = await (isRaw ? query.getRawMany() : query.getMany()).then(
      (nodes) => {
        if (take && nodes.length > take) {
          hasNextPage = true;
        }
        return nodes.slice(0, take);
      },
    );

    return {
      totalCount: await qbForCount.getCount(),
      nodes: nodes.slice(0, take),
      hasPrevPage: !!params.nextPageCursor,
      hasNextPage,
      prevPageCursor:
        nodes.length > 0
          ? this._stringifyCursor(this._createCursor(nodes[0]))
          : null,
      nextPageCursor:
        nodes.length > 0
          ? this._stringifyCursor(
              this._createCursor(nodes[nodes.length - 1]),
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
  ): string {
    return this._transformer.stringify(cursor);
  }

  private _parseCursor(
    cursorString: string,
  ): Cursor<TEntity> {
    return this._transformer.parse(cursorString);
  }
}
