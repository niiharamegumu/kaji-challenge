import { z } from "zod";

export const sharedPageLimits = {
  bytes: 256_000,
  blocks: 1000,
  depth: 8,
  leaseSeconds: 90,
} as const;

const stylesSchema = z.strictObject({
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  code: z.boolean().optional(),
});
const textSchema = z.strictObject({
  type: z.literal("text"),
  text: z.string().max(100_000),
  styles: stylesSchema,
});
const hrefSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        ["https:", "http:", "mailto:", "tel:"].includes(url.protocol) &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, "リンクには http / https / mailto / tel を指定してください。");
const inlineSchema = z.discriminatedUnion("type", [
  textSchema,
  z.strictObject({ type: z.literal("link"), href: hrefSchema, content: z.array(textSchema) }),
]);
const baseProps = {
  textColor: z.literal("default").optional(),
  backgroundColor: z.literal("default").optional(),
  textAlignment: z.enum(["left", "center", "right", "justify"]).optional(),
};
const propsSchema = z.strictObject({
  ...baseProps,
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  checked: z.boolean().optional(),
  start: z.number().int().min(1).max(1_000_000).optional(),
  isToggleable: z.literal(false).optional(),
});
export type SharedPageBlock = {
  id: string;
  type: "paragraph" | "heading" | "bulletListItem" | "numberedListItem" | "checkListItem";
  props: z.infer<typeof propsSchema>;
  content: z.infer<typeof inlineSchema>[];
  children: SharedPageBlock[];
};
const blockSchema: z.ZodType<SharedPageBlock> = z.lazy(() =>
  z.strictObject({
    id: z.string().min(1).max(128),
    type: z.enum(["paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem"]),
    props: propsSchema,
    content: z.array(inlineSchema).max(10_000),
    children: z.array(blockSchema).max(sharedPageLimits.blocks),
  }),
);

// Bound size and nesting before recursive parsing, including hostile direct API requests.
const boundedBlocksSchema = z
  .unknown()
  .superRefine((value, context) => {
    const stack = [{ value, depth: 0 }];
    let count = 0;
    const ids = new Set<string>();
    while (stack.length) {
      const entry = stack.pop()!;
      if (!Array.isArray(entry.value) || entry.depth > sharedPageLimits.depth) {
        context.addIssue({ code: "custom", message: "本文の階層が深すぎます。" });
        return;
      }
      for (const block of entry.value) {
        if (++count > sharedPageLimits.blocks || !block || typeof block !== "object") {
          context.addIssue({ code: "custom", message: "本文のブロック数を確認してください。" });
          return;
        }
        if (typeof block.id === "string") {
          if (ids.has(block.id)) {
            context.addIssue({ code: "custom", message: "本文のブロックIDが重複しています。" });
            return;
          }
          ids.add(block.id);
        }
        stack.push({ value: block.children, depth: entry.depth + 1 });
      }
    }
    try {
      if (new TextEncoder().encode(JSON.stringify(value)).byteLength > sharedPageLimits.bytes) {
        context.addIssue({ code: "custom", message: "本文は256KB以内にしてください。" });
      }
    } catch {
      context.addIssue({ code: "custom", message: "本文には保存できない値が含まれています。" });
    }
  })
  .pipe(z.array(blockSchema).max(sharedPageLimits.blocks));

export const SharedPageDocumentSchema = z.strictObject({
  format: z.literal("blocknote"),
  schemaVersion: z.literal(1),
  blocks: boundedBlocksSchema,
});
const titleSchema = z.string().trim().min(1).max(200);
const editingSchema = z
  .strictObject({
    userId: z.string(),
    displayName: z.string(),
    expiresAt: z.iso.datetime(),
  })
  .nullable();
const summaryFields = {
  id: z.uuid(),
  title: titleSchema,
  version: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  updatedByName: z.string(),
  editing: editingSchema,
};
export const SharedPageSummarySchema = z.strictObject({ ...summaryFields, preview: z.string() });
export const SharedPageSchema = z.strictObject({
  ...summaryFields,
  document: SharedPageDocumentSchema,
});
export const SharedPageListSchema = z.strictObject({ items: z.array(SharedPageSummarySchema) });
export const SharedPageLeaseSchema = z.strictObject({
  expiresAt: z.iso.datetime(),
  serverNow: z.iso.datetime(),
});
export const SharedPageLeaseResponseSchema = z.strictObject({
  page: SharedPageSchema,
  lease: SharedPageLeaseSchema,
});
const pageDraftSchema = z.strictObject({
  title: titleSchema,
  document: SharedPageDocumentSchema,
});
export const CreateSharedPageSchema = pageDraftSchema.extend({ requestId: z.uuid().optional() });
export const UpdateSharedPageSchema = pageDraftSchema.extend({
  expectedVersion: z.number().int().nonnegative(),
});
export const DeleteSharedPageSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative(),
});
export type SharedPageDocument = z.infer<typeof SharedPageDocumentSchema>;
export type SharedPage = z.infer<typeof SharedPageSchema>;
export type SharedPageSummary = z.infer<typeof SharedPageSummarySchema>;
export type SharedPageLease = z.infer<typeof SharedPageLeaseSchema>;
export type SharedPageLeaseResponse = z.infer<typeof SharedPageLeaseResponseSchema>;
export type CreateSharedPageRequest = z.infer<typeof CreateSharedPageSchema>;
export type UpdateSharedPageRequest = z.infer<typeof UpdateSharedPageSchema>;
export type DeleteSharedPageRequest = z.infer<typeof DeleteSharedPageSchema>;
