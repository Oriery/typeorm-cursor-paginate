import { ObjectLiteral } from "typeorm";
import { Cursor, CursorTransformer } from "../interfaces/paginator";

export class JsonTransformer<
  TEntity extends ObjectLiteral,
> implements CursorTransformer<TEntity> {
  parse(text: string): Cursor<TEntity> {
    return JSON.parse(text) as Cursor<TEntity>;
  }

  stringify(cursor: Cursor<TEntity>): string {
    return JSON.stringify(cursor);
  }
}
