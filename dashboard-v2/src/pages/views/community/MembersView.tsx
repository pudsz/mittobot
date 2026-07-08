import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { useGuild } from "@/hooks/useGuild";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Users } from "lucide-react";

interface RolesMeta {
  hasGuild: boolean;
  roles: { id: string; name: string; color?: number }[];
}

interface MemberRow {
  id: string; username: string; displayName: string;
  isBot: boolean; avatarUrl?: string; topColor?: string;
}

interface RolesMembersResponse {
  hasGuild: boolean;
  roles: { id: string; name: string; color?: string; memberCount: number; members: MemberRow[] }[];
}

export default function MembersView() {
  const { guildId } = useGuild();
  const [search, setSearch] = useState("");

  const meta = useQuery<RolesMeta>({
    queryKey: ["guild", guildId, "meta"],
    queryFn: () => get(`/api/automod?guildId=${guildId}`),
    enabled: !!guildId,
  });

  const roleIds = (meta.data?.roles || []).map(r => r.id).join(",");
  const members = useQuery<RolesMembersResponse>({
    queryKey: ["roles-members", guildId, roleIds],
    queryFn: () => get(`/api/roles/members?guildId=${guildId}${roleIds ? `&roleIds=${roleIds}` : ""}`),
    enabled: !!guildId && roleIds.length > 0,
    staleTime: 30_000,
  });

  if (!guildId) return <div className="p-6 text-sm text-muted-foreground">Select a guild first.</div>;
  if (meta.isLoading || !meta.data) return <div className="p-6 text-sm text-muted-foreground">Loading roles...</div>;

  const allMembers = new Map<string, { id: string; username: string; displayName: string; isBot: boolean; roles: string[] }>();
  let totalMemberCount = 0;

  (members.data?.roles || []).forEach(({ name, memberCount, members: ms }) => {
    totalMemberCount += memberCount;
    ms.forEach(m => {
      const existing = allMembers.get(m.id);
      if (existing) {
        if (!existing.roles.includes(name)) existing.roles.push(name);
      } else {
        allMembers.set(m.id, { id: m.id, username: m.username, displayName: m.displayName, isBot: m.isBot, roles: [name] });
      }
    });
  });

  const memberList = Array.from(allMembers.values()).filter(m =>
    !search ||
    m.username.toLowerCase().includes(search.toLowerCase()) ||
    m.displayName.toLowerCase().includes(search.toLowerCase()) ||
    m.id.includes(search) ||
    m.roles.some(r => r.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Users className="size-5 text-primary" />
        <div>
          <h1 className="text-xl font-bold tracking-tight">Role Members</h1>
          <p className="text-xs text-muted-foreground">{memberList.length} members across all roles</p>
        </div>
      </div>

      <Card className="border-border/40 bg-card/40">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Filter</CardTitle>
          <CardDescription className="text-xs">Search by name, ID, or role</CardDescription>
        </CardHeader>
        <CardContent>
          <Input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} className="text-xs font-mono" />
        </CardContent>
      </Card>

      <Card className="border-border/40 bg-card/40">
        <CardContent className="p-0">
          {members.isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading members…</div>
          ) : memberList.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No members found.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border/30">
                  <TableHead className="text-xs">Member</TableHead>
                  <TableHead className="text-xs">ID</TableHead>
                  <TableHead className="text-xs">Roles</TableHead>
                  <TableHead className="text-xs">Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memberList.slice(0, 200).map(m => (
                  <TableRow key={m.id} className="border-b border-border/20">
                    <TableCell className="text-xs">{m.displayName}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">{m.id}</TableCell>
                    <TableCell className="text-xs">
                      <div className="flex flex-wrap gap-1">
                        {m.roles.slice(0, 4).map(r => <Badge key={r} variant="outline" className="text-[10px]">{r}</Badge>)}
                        {m.roles.length > 4 && <span className="text-[10px] text-muted-foreground">+{m.roles.length - 4}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{m.isBot ? <Badge variant="outline" className="text-[10px]">Bot</Badge> : <span className="text-muted-foreground">User</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
