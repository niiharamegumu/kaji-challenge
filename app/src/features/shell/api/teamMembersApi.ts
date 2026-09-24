import { getTeamCurrentMembers } from "../../../lib/api/operations";

export async function listCurrentTeamMembers() {
  return (await getTeamCurrentMembers()).data.items;
}
