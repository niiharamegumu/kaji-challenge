import { getTeamCurrentMembers } from "../../../lib/api/generated/client";

export async function listCurrentTeamMembers() {
  return (await getTeamCurrentMembers()).data.items;
}
