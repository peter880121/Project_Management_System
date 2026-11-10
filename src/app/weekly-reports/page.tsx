import { redirect } from "next/navigation";
import { getCurrentUser } from "@/modules/auth/session";
import { WeeklyWorkspace } from "@/components/weekly-reports/workspace";
import { PageBreadcrumbs } from "@/components/layout/page-breadcrumbs";
export const dynamic = "force-dynamic";
export default async function WeeklyPage() {
  if (!(await getCurrentUser())) redirect("/login?next=/weekly-reports");
  return (
    <>
      <PageBreadcrumbs
        pathname="/weekly-reports"
        items={[{ label: "个人周报" }]}
      />
      <WeeklyWorkspace />
    </>
  );
}
