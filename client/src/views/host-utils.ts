import type { Task } from '../types';

export interface HostProfile {
  ip: string;
  openPorts: number[];
  services: string[];
  protocols: string[];
  tools: string[];
  roles: string[];
  components: string[];
  lastSeen: string;
}

const dedupeSort = (items: string[]) => Array.from(new Set(items.filter(Boolean))).sort((a, b) => a.localeCompare(b));
const toServiceKey = (service: string) => service.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

const roleByService: Record<string, string> = {
  http: 'Web', https: 'Web', nginx: 'Web', apache: 'Web', iis: 'Web',
  mysql: 'Database', mssql: 'Database', postgresql: 'Database', mongodb: 'Database',
  redis: 'Cache', ssh: 'Remote Access', rdp: 'Remote Access',
  smb: 'File Service', ftp: 'File Service',
  dns: 'Infrastructure', ntp: 'Infrastructure', snmp: 'Infrastructure',
};

const componentByService: Record<string, string> = {
  http: 'HTTP Stack', https: 'TLS Endpoint', nginx: 'Nginx', apache: 'Apache', iis: 'IIS',
  mysql: 'MySQL', postgresql: 'PostgreSQL', mssql: 'SQL Server', redis: 'Redis', mongodb: 'MongoDB',
  ssh: 'SSH Daemon', rdp: 'RDP Service', smb: 'SMB Service', ftp: 'FTP Service',
  dns: 'DNS Service',
};

export const buildHostProfiles = (task: Task): HostProfile[] => {
  const byIp = new Map<string, typeof task.results>();
  for (const row of task.results || []) {
    if (!row.ip) continue;
    const rows = byIp.get(row.ip) ?? [];
    rows.push(row);
    byIp.set(row.ip, rows);
  }

  return Array.from(byIp.entries())
    .map(([ip, rows]) => {
      const openRows = rows.filter((r) => r.state?.toLowerCase() === 'open');
      const rowsForProfile = openRows.length > 0 ? openRows : rows;
      const services = dedupeSort(rowsForProfile.map((r) => (r.service || 'unknown').trim()));
      const serviceKeys = services.map(toServiceKey);
      const roles = dedupeSort(serviceKeys.map((k) => roleByService[k]).filter(Boolean));
      const components = dedupeSort(serviceKeys.map((k) => componentByService[k]).filter(Boolean));
      const timestamps = rowsForProfile.map((r) => r.timestamp).filter(Boolean).sort();
      return {
        ip,
        openPorts: Array.from(new Set(rowsForProfile.map((r) => r.port).filter((p) => Number.isFinite(p)))).sort((a, b) => a - b),
        services,
        protocols: dedupeSort(rowsForProfile.map((r) => r.protocol)),
        tools: dedupeSort(rowsForProfile.map((r) => r.tool)),
        roles: roles.length > 0 ? roles : ['General Host'],
        components,
        lastSeen: timestamps[timestamps.length - 1] || '',
      };
    })
    .sort((a, b) => a.ip.localeCompare(b.ip));
};
