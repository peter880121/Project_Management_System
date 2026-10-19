import { AcceptancePanel } from "@/components/projects/acceptance-panel";
export default async function Page({ params }: { params: Promise<{ projectId: string }> }) { return <main className="mx-auto max-w-5xl px-6 py-8"><AcceptancePanel projectId={(await params).projectId} /></main>; }
