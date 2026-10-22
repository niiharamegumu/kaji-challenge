export interface WeeklyRequirement {
  effectiveWeek: string;
  requiredCompletionsPerWeek: number;
}

export interface TaskRequirements {
  RequiredCompletionsPerWeek: number;
  WeeklyRequirements?: WeeklyRequirement[];
}

/** Initial requirements remain the fallback for every week before the first edit. */
export function requiredForWeek(task: TaskRequirements, week: string): number {
  let latest: WeeklyRequirement | undefined;
  for (const requirement of task.WeeklyRequirements ?? []) {
    if (
      requirement.effectiveWeek <= week &&
      (!latest || requirement.effectiveWeek > latest.effectiveWeek)
    )
      latest = requirement;
  }
  return latest?.requiredCompletionsPerWeek ?? task.RequiredCompletionsPerWeek;
}
