import type { Repository } from "./ports";
import { ownTeamName } from "../domain/rules";

/** 初期チームと所属を条件付きSQLの同じbatchで作成する。 */
export async function provisionUser(repo: Repository, userId: string, now: Date) {
  if ((await repo.ListMembershipsByUserID(userId)).length) return;
  const user = await repo.GetUserByID(userId);
  await repo.ProvisionUser(
    userId,
    crypto.randomUUID(),
    ownTeamName(user.DisplayName),
    now.toISOString(),
  );
}
