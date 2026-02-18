import { useAtom } from "jotai";

import { statusMessageAtom } from "../../shell/state/status";
import { InviteManager } from "../components/InviteManager";
import { useInviteMutations } from "../hooks/useAdminMutations";
import { inviteCodeAtom, joinCodeAtom } from "../state/ui";

export function AdminInvitesPage() {
  const [inviteCode, setInviteCode] = useAtom(inviteCodeAtom);
  const [joinCode, setJoinCode] = useAtom(joinCodeAtom);
  const [, setStatus] = useAtom(statusMessageAtom);
  const { createInvite, joinTeam } = useInviteMutations(setStatus);

  const handleCreateInvite = async () => {
    const res = await createInvite.mutateAsync();
    setInviteCode(res.data.code);
    setStatus("招待コードを発行しました");
  };

  return (
    <section className="mt-4 pb-2">
      <InviteManager
        inviteCode={inviteCode}
        joinCode={joinCode}
        isCreatingInvite={createInvite.isPending}
        isJoiningTeam={joinTeam.isPending}
        onJoinCodeChange={setJoinCode}
        onCreateInvite={() => {
          void handleCreateInvite();
        }}
        onJoinTeam={() => {
          void joinTeam.mutateAsync(joinCode);
        }}
      />
    </section>
  );
}
