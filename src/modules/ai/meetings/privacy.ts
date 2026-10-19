import { containsLikelySensitiveInput } from "../wbs/service";
import { planningDate } from "@/modules/planning/schemas";
/** Calendar dates are expected meeting evidence, not telephone numbers. Only exempt valid dates. */
export function containsSensitiveMeetingInput(text: string) {
  const withoutDates = text.replace(/\b20\d{2}-\d{2}-\d{2}\b/g, date => planningDate.safeParse(date).success ? "[calendar-date]" : date);
  return containsLikelySensitiveInput(withoutDates);
}
