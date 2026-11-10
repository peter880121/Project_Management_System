import { AcceptancePanel } from "@/components/projects/acceptance-panel";
import { PageBackLink } from "@/components/page-back-link";
export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <main className="mx-auto max-w-5xl px-6 py-8"><PageBackLink href={`/projects/${projectId}/board`}>返回任务看板</PageBackLink><AcceptancePanel projectId={projectId} /></main>;
}
