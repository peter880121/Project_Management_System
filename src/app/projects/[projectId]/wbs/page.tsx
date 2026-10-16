import { ProjectWorkspace } from "@/components/project-workspace";
import { WbsPanel } from "../board/wbs-panel";
export const dynamic = "force-dynamic";
export default async function WbsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectWorkspace projectId={projectId} title="WBS 与工期建议" roles={["PM"]} breadcrumb={{ segment: "wbs", label: "智能 WBS 分解" }}><WbsPanel projectId={projectId} /></ProjectWorkspace>;
}
