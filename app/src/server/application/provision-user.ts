import type { Repository } from "./ports";
import { ownTeamName } from "../domain/rules";

/** Auth owns user creation. Membership is the marker for completed application setup. */
export async function provisionUser(repository: Repository, userId: string, now: Date) {
  await repository.transaction(async (repo) => {
    if ((await repo.ListMembershipsByUserID(userId)).length) return;
    const user = await repo.GetUserByID(userId);
    const teamId = crypto.randomUUID();
    await repo.CreateTeam({
      ID: teamId,
      Name: ownTeamName(user.DisplayName),
      CreatedAt: now.toISOString(),
    });
    await repo.AddTeamMember({
      TeamID: teamId,
      UserID: userId,
      Role: "owner",
      CreatedAt: now.toISOString(),
    });
  });
}
