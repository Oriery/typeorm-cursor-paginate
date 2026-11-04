import type {
  CursorEnvelope,
  CursorTransformer,
} from "../interfaces/paginator";

export class JsonTransformer implements CursorTransformer {
  parse(text: string): unknown {
    return JSON.parse(text) as unknown;
  }

  stringify(cursor: CursorEnvelope): string {
    return JSON.stringify(cursor);
  }
}
