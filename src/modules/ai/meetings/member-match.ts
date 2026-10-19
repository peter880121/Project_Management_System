export type SuggestedMember = { id: string; name: string };
export function memberSearchSeed(suggestion: string | null | undefined) {
  const name = suggestion?.trim().replace(/(?:工程师|老师|经理|主任|工|总)$/u, "").trim() ?? "";
  return name;
}
export function matchingMembers<T extends SuggestedMember>(members: T[], query: string): T[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return members;
  return members.filter(member => member.name.toLocaleLowerCase().includes(normalized));
}
