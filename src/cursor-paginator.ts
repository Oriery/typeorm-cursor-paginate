import { SelectQueryBuilder, ObjectType, ObjectLiteral, KeysOfAType } from 'typeorm'

import { CursorPagination, Cursor, OrderBy, CursorTransformer, Nullable, Take, PromiseCursorPagination } from './interfaces/paginator'
import { Base64Transformer } from './transformers/base64-transformer'
import { normalizeOrderBy } from './utils/normalizeOrderBy'


export interface CursorPaginatorParams<TEntity extends ObjectLiteral> {
  orderBy: OrderBy<TEntity> | OrderBy<TEntity>[]
  take?: Nullable<Take> | number | null
  transformer?: CursorTransformer<TEntity> | null
}

export interface CursorPaginatorPaginateParams {
  prevCursor?: string | null
  nextCursor?: string | null
  take?: number | null
}

export class CursorPaginator<TEntity extends ObjectLiteral> {

  orders: [string, boolean][] = []
  takeOptions: Take
  transformer: CursorTransformer<TEntity>

  constructor(
    public entity: ObjectType<TEntity>,
    {
      orderBy,
      take,
      transformer,
    }: CursorPaginatorParams<TEntity>,
  ) {
    this.orders = normalizeOrderBy(orderBy)
    this.takeOptions = typeof take === 'number' ? {
      default: take,
      min: 0,
      max: Infinity,
    } : {
      default: take?.default ?? 20,
      min: Math.max(0, take?.min ?? 0), // never negative
      max: take?.max ?? Infinity,
    }
    this.transformer = transformer ?? new Base64Transformer()
  }

  async paginate(qb: SelectQueryBuilder<TEntity>, params: CursorPaginatorPaginateParams = {}, isRaw = false): Promise<CursorPagination<TEntity>> {
    const take = Math.max(this.takeOptions.min, Math.min(params.take ?? this.takeOptions.default, this.takeOptions.max))

    const qbForCount = qb.clone()

    if (params.prevCursor) {
      try {
        this._applyWhereQuery(qb, this.transformer.parse(params.prevCursor), false)
      } catch {
        qb.andWhere('1 = 0')
      }
      for (const [key, value] of this.orders) {
        qb.addOrderBy(`${qb.alias}.${key}`, value ? 'DESC' : 'ASC')
      }

      let hasPrev = false
      const query = qb.clone().take(take + 1)
      const nodes = await (isRaw ? query.getRawMany() : query.getMany()).then(nodes => {
        if (nodes.length > take) {
          hasPrev = true
        }
        return nodes.slice(0, take).reverse()
      })

      return {
        count: await qbForCount.getCount(),
        nodes,
        hasPrev,
        hasNext: true,
        prevCursor: nodes.length > 0 ? this.transformer.stringify(this._createCursor(nodes[0])) : null,
        nextCursor: nodes.length > 0 ? this.transformer.stringify(this._createCursor(nodes[nodes.length - 1])) : null,
      }
    }

    if (params.nextCursor) {
      try {
        this._applyWhereQuery(qb, this.transformer.parse(params.nextCursor), true)
      } catch {
        qb.andWhere('1 = 0')
      }
    }
    for (const [key, value] of this.orders) {
      qb.addOrderBy(`${qb.alias}.${key}`, value ? 'ASC' : 'DESC')
    }

    let hasNext = false
    const query = qb.clone().take(take + 1)
    const nodes = await (isRaw ? query.getRawMany() : query.getMany()).then(nodes => {
      if (nodes.length > take) {
        hasNext = true
      }
      return nodes.slice(0, take)
    })

    return {
      count: await qbForCount.getCount(),
      nodes: nodes.slice(0, take),
      hasPrev: !!params.nextCursor,
      hasNext,
      prevCursor: nodes.length > 0 ? this.transformer.stringify(this._createCursor(nodes[0])) : null,
      nextCursor: nodes.length > 0 ? this.transformer.stringify(this._createCursor(nodes[nodes.length - 1])) : null,
    }
  }

  promisePaginate(qb: SelectQueryBuilder<TEntity>, params: CursorPaginatorPaginateParams = {}, isRaw = false): PromiseCursorPagination<TEntity> {
    const take = Math.max(this.takeOptions.min, Math.min(params.take ?? this.takeOptions.default, this.takeOptions.max))

    const qbForCount = qb.clone()

    if (params.prevCursor) {
      try {
        this._applyWhereQuery(qb, this.transformer.parse(params.prevCursor), false)
      } catch {
        qb.andWhere('1 = 0')
      }
      for (const [key, value] of this.orders) {
        qb.addOrderBy(`${qb.alias}.${key}`, value ? 'DESC' : 'ASC')
      }

      let cachePromiseNodes = null as Promise<Omit<CursorPagination<any>, 'count'>> | null
      const promiseNodes = () => {
        if (!cachePromiseNodes) {
          const query = qb.clone().take(take + 1)
          cachePromiseNodes = (isRaw ? query.getRawMany() : query.getMany()).then(nodes => {
            let hasPrev = false
            if (nodes.length > take) {
              hasPrev = true
            }
            nodes = nodes.slice(0, take).reverse()
            return {
              nodes,
              hasPrev,
              hasNext: true,
              prevCursor: nodes.length > 0 ? this.transformer.stringify(this._createCursor(nodes[0])) : null,
              nextCursor: nodes.length > 0 ? this.transformer.stringify(this._createCursor(nodes[nodes.length - 1])) : null,
            }
          })
        }
        return cachePromiseNodes
      }

      return {
        get count() {
          return qbForCount.getCount()
        },
        get nodes() {
          return promiseNodes().then(({ nodes }) => nodes)
        },
        get hasPrev() {
          return promiseNodes().then(({ hasPrev }) => hasPrev)
        },
        get hasNext() {
          return promiseNodes().then(({ hasNext }) => hasNext)
        },
        get prevCursor() {
          return promiseNodes().then(({ prevCursor }) => prevCursor)
        },
        get nextCursor() {
          return promiseNodes().then(({ nextCursor }) => nextCursor)
        },
      }
    }

    if (params.nextCursor) {
      try {
        this._applyWhereQuery(qb, this.transformer.parse(params.nextCursor), true)
      } catch {
        qb.andWhere('1 = 0')
      }
    }
    for (const [key, value] of this.orders) {
      qb.addOrderBy(`${qb.alias}.${key}`, value ? 'ASC' : 'DESC')
    }

    let cachePromiseNodes = null as Promise<Omit<CursorPagination<any>, 'count'>> | null
    const promiseNodes = () => {
      if (!cachePromiseNodes) {
        const query = qb.clone().take(take + 1)
        cachePromiseNodes = (isRaw ? query.getRawMany() : query.getMany()).then(nodes => {
          let hasNext = false
          if (nodes.length > take) {
            hasNext = true
          }
          nodes = nodes.slice(0, take)
          return {
            nodes: nodes.slice(0, take),
            hasPrev: !!params.nextCursor,
            hasNext,
            prevCursor: nodes.length > 0 ? this.transformer.stringify(this._createCursor(nodes[0])) : null,
            nextCursor: nodes.length > 0 ? this.transformer.stringify(this._createCursor(nodes[nodes.length - 1])) : null,
          }
        })
      }
      return cachePromiseNodes
    }

    return {
      get count() {
        return qbForCount.getCount()
      },
      get nodes() {
        return promiseNodes().then(({ nodes }) => nodes)
      },
      get hasPrev() {
        return promiseNodes().then(({ hasPrev }) => hasPrev)
      },
      get hasNext() {
        return promiseNodes().then(({ hasNext }) => hasNext)
      },
      get prevCursor() {
        return promiseNodes().then(({ prevCursor }) => prevCursor)
      },
      get nextCursor() {
        return promiseNodes().then(({ nextCursor }) => nextCursor)
      },
    }
  }

  _applyWhereQuery(qb: SelectQueryBuilder<TEntity>, cursor: Cursor<TEntity>, isNext: boolean) {
    const metadata = qb.expressionMap.mainAlias?.metadata

    if (!metadata) {
      throw new Error('Metadata is not defined')
    }

    let queryPrefix = ''
    const queryParts = [] as string[]
    const queryParams = {} as Record<string, any>

    for (const [key, asc] of this.orders) {
      const columnName = `${qb.alias}.${key}`
      queryParts.push(`(${queryPrefix}${columnName} ${!asc !== isNext ? '>' : '<'} :cursor__${key})`)
      queryPrefix = `${queryPrefix}${columnName} = :cursor__${key} AND `

      const column = metadata.findColumnWithPropertyPath(key)
      queryParams[`cursor__${key}`] = column ? qb.connection.driver.preparePersistentValue(cursor[key as keyof TEntity], column) : cursor[key as keyof TEntity]
    }

    qb.andWhere(`(${queryParts.join(' OR ')})`, queryParams)
  }

  _createCursor(node: TEntity): Cursor<TEntity> {
    const cursor = {} as Cursor<TEntity>
    for (const [key, _] of this.orders) {
      cursor[key as keyof TEntity] = node[key as keyof TEntity]
    }
    return cursor
  }
}
