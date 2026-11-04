import type {
  CursorEnvelope,
  CursorTransformer,
} from "../interfaces/paginator";

export class Base64Transformer implements CursorTransformer {
  parse(text: string): unknown {
    if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error("Invalid base64url");
    const bytes = Buffer.from(text, "base64url");
    if (bytes.toString("base64url") !== text)
      throw new Error("Noncanonical base64url");
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  }

  stringify(cursor: CursorEnvelope): string {
    return Buffer.from(JSON.stringify(cursor)).toString("base64url");
  }
}
