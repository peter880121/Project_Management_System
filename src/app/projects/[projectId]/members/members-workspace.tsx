"use client";
import { useState } from "react";
import { MemberCapacityPanel } from "@/components/planning/member-capacity-panel";
import { MembersPanel } from "./members-panel";
export function MembersWorkspace({ projectId, onboarding }: { projectId: string; onboarding: boolean }) {
  const [capacityBusy, setCapacityBusy] = useState(false); const [revision, setRevision] = useState(0);
  return <><MembersPanel projectId={projectId} onboarding={onboarding} navigationBusy={capacityBusy} onSaved={() => setRevision(value => value + 1)} /><MemberCapacityPanel projectId={projectId} revision={revision} onBusyChange={setCapacityBusy} /></>;
}
