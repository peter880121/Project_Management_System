import { z } from "zod";

export const roles = ["ADMIN", "PM", "MEMBER", "QA"] as const;
export const statuses = ["ACTIVE", "PENDING", "DISABLED"] as const;
export const listUsersSchema = z.object({
  role: z.enum(roles).optional(), status: z.enum(statuses).optional(),
  keyword: z.string().trim().max(191).optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export const createUserSchema = z.object({
  name: z.string().trim().min(1, "请输入姓名").max(191),
  email: z.string().trim().email("邮箱格式不正确").max(191).transform((value) => value.toLowerCase()),
  role: z.enum(roles),
  initialPassword: z.string().min(8, "密码至少 8 位，且必须包含字母和数字")
    .regex(/\p{L}/u, "密码必须包含字母和数字").regex(/[0-9]/, "密码必须包含字母和数字")
    .refine((value) => new TextEncoder().encode(value).length <= 72, "密码不能超过 72 字节"),
}).strict();
export const roleSchema = z.object({ role: z.enum(roles) }).strict();
export const statusSchema = z.object({ status: z.enum(["ACTIVE", "DISABLED"]) }).strict();
export const userIdSchema = z.uuid();
export type ListUsersQuery = z.infer<typeof listUsersSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;

export function parseListUsersQuery(params: URLSearchParams) {
  const input: Record<string, string | string[]> = {};
  for (const key of params.keys()) {
    const values = params.getAll(key);
    input[key] = values.length === 1 ? values[0] : values;
  }
  return listUsersSchema.safeParse(input);
}
