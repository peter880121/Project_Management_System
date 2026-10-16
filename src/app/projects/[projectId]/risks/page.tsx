import { ProjectWorkspace } from "@/components/project-workspace";
import { RiskPanel } from "../board/risk-panel";
export const dynamic = "force-dynamic";
export default async function RisksPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectWorkspace projectId={projectId} title="风险预警与扫描计划" roles={["PM"]}><RiskPanel projectId={projectId} /></ProjectWorkspace>;
}
