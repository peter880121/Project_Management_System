import type { Prisma } from "@prisma/client";
import { hkToday, weekWindow } from "./policy";
type Tx = Prisma.TransactionClient;
export async function initializePeriod(tx: Tx, value: string) {
  const window = weekWindow(value);
  // The unique period insertion serializes the first roster capture. Historical weeks
  // are not manufactured from today's employee list.
  const current = weekWindow(hkToday());
  if (window.start.getTime() !== current.start.getTime()) return window;
  const created = await tx.weeklyReportPeriod.createMany({
    data: [{ weekStart: window.start, deadline: window.deadline }],
    skipDuplicates: true,
  });
  if (created.count) {
    await tx.$executeRaw`INSERT INTO WeeklyReportExpectation (id,authorId,weekStart,role,deadline,createdAt) SELECT UUID(),id,${window.start},role,${window.deadline},UTC_TIMESTAMP(3) FROM User WHERE status='ACTIVE' AND isSystem=FALSE AND createdAt<=UTC_TIMESTAMP(3)`;
  }
  return window;
}
