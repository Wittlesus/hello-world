import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { ErrorState, LoadingState } from './LoadingState.js';
import { ViewShell } from './ViewShell.js';

interface Plugin {
  name: string;
  source: string;
  key: string;
}

interface DiscordBot {
  name: string;
  appId: string;
  patUserId: string;
  server: string;
  status: string;
}

interface Account {
  service: string;
  username: string;
  purpose: string;
}

interface Capabilities {
  plugins: Plugin[];
  mcpServers: string[];
  discordBot: DiscordBot;
  accounts: Account[];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="text-[11px] uppercase tracking-widest text-gray-500 font-semibold mb-3">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({
  label,
  sub,
  badge,
  badgeColor = 'bg-gray-700 text-gray-300',
}: {
  label: string;
  sub?: string;
  badge?: string;
  badgeColor?: string;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-[#1a1a24] border border-gray-800 rounded-lg">
      <div>
        <span className="text-sm text-gray-100">{label}</span>
        {sub && <span className="block text-xs text-gray-500 mt-0.5">{sub}</span>}
      </div>
      {badge && (
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${badgeColor}`}>
          {badge}
        </span>
      )}
    </div>
  );
}

export function SkillsView() {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<Capabilities>('get_capabilities')
      .then(setCaps)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!caps) return <ErrorState message="No capabilities data returned." />;

  return (
    <ViewShell
      title="Skills"
      description="Claude's connected capabilities — plugins, MCP servers, accounts"
    >
      <Section title={`Plugins (${caps.plugins.length})`}>
        {caps.plugins.length === 0 ? (
          <p className="text-xs text-gray-500">No plugins enabled.</p>
        ) : (
          caps.plugins.map((p) => (
            <Row
              key={p.key}
              label={p.name}
              sub={p.source || undefined}
              badge="enabled"
              badgeColor="bg-emerald-500/20 text-emerald-300"
            />
          ))
        )}
      </Section>

      <Section title={`MCP Servers (${caps.mcpServers.length})`}>
        {caps.mcpServers.length === 0 ? (
          <p className="text-xs text-gray-500">No MCP servers detected.</p>
        ) : (
          caps.mcpServers.map((name) => (
            <Row
              key={name}
              label={name}
              badge="connected"
              badgeColor="bg-blue-500/20 text-blue-300"
            />
          ))
        )}
      </Section>

      <Section title="Discord Bot">
        <Row
          label={caps.discordBot.name}
          sub={`App ID: ${caps.discordBot.appId} · Server: ${caps.discordBot.server}`}
          badge={caps.discordBot.status}
          badgeColor="bg-violet-500/20 text-violet-300"
        />
      </Section>

      <Section title={`Accounts (${caps.accounts.length})`}>
        {caps.accounts.map((a) => (
          <Row
            key={a.service}
            label={a.service}
            sub={`${a.username} · ${a.purpose}`}
            badge="linked"
            badgeColor="bg-gray-700 text-gray-400"
          />
        ))}
      </Section>
    </ViewShell>
  );
}
