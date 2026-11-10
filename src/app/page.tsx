import { getCurrentUser } from "@/modules/auth/session";
import { LandingPage } from "@/components/landing-page";
import { AssistantWorkspace } from "@/components/assistant/assistant-workspace";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await getCurrentUser();
  return user ? <AssistantWorkspace role={user.role} /> : <LandingPage />;
}
