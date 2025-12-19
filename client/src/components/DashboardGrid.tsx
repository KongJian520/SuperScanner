import React, { useMemo } from 'react';
import { 
  PieChart, Pie, Cell, ResponsiveContainer, 
  BarChart, Bar, XAxis, YAxis, Tooltip, 
} from 'recharts';
import { 
  Layers, 
  Monitor, 
  Terminal, 
  ShieldAlert, 
  CheckCircle2, 
  ChevronRight,
  Cpu,
  Network,
  Server,
  Globe
} from 'lucide-react';
import { COLORS } from '../constants';
import { ScanResult } from '../types';

const StatCard: React.FC<{ title: string; value: number; icon: React.ReactNode; color: string }> = ({ title, value, icon, color }) => (
  <div className="relative overflow-hidden bg-blue-600 rounded-xl p-5 group transition-transform hover:-translate-y-1">
    <div className="absolute right-[-10px] bottom-[-10px] opacity-20 transform scale-150 rotate-[-15deg] group-hover:scale-[1.8] transition-transform">
      {icon}
    </div>
    <div className="relative z-10 flex flex-col gap-1">
      <p className="text-white/80 text-sm font-medium tracking-wide uppercase">{title}</p>
      <p className="text-4xl font-black text-white">{value}</p>
    </div>
  </div>
);

const ChartCard: React.FC<{ 
  title: string; 
  icon: React.ReactNode; 
  children: React.ReactNode;
  verified?: boolean;
}> = ({ title, icon, children, verified = true }) => (
  <div className="bg-[#18181b] rounded-xl border border-zinc-800/50 flex flex-col h-[320px]">
    <div className="p-4 flex items-center justify-between border-b border-zinc-800/50">
      <div className="flex items-center gap-2">
        <span className="text-blue-500">{icon}</span>
        <span className="font-semibold text-sm">{title}</span>
        {verified && <CheckCircle2 size={14} className="text-green-500/80" />}
      </div>
      <ChevronRight size={16} className="text-zinc-600 cursor-pointer hover:text-zinc-400" />
    </div>
    <div className="flex-1 p-4 flex items-center justify-center overflow-hidden">
      {children}
    </div>
  </div>
);

interface DashboardGridProps {
  results: ScanResult[];
}

const DashboardGrid: React.FC<DashboardGridProps> = ({ results = [] }) => {
  const chartColors = [COLORS.blue, COLORS.purple, COLORS.green, COLORS.yellow, COLORS.red];

  const stats = useMemo(() => {
    const uniqueIps = new Set(results.map(r => r.ip));
    const totalPorts = results.length;
    
    // Port distribution
    const portCounts: Record<string, number> = {};
    results.forEach(r => {
      const p = r.port.toString();
      portCounts[p] = (portCounts[p] || 0) + 1;
    });
    const topPorts = Object.entries(portCounts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    // Service distribution
    const serviceCounts: Record<string, number> = {};
    results.forEach(r => {
      const s = r.service || 'unknown';
      serviceCounts[s] = (serviceCounts[s] || 0) + 1;
    });
    const topServices = Object.entries(serviceCounts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    // Protocol distribution (using as "Hardware" placeholder or similar category)
    const protocolCounts: Record<string, number> = {};
    results.forEach(r => {
      const p = r.protocol || 'tcp';
      protocolCounts[p] = (protocolCounts[p] || 0) + 1;
    });
    const protocols = Object.entries(protocolCounts)
      .map(([name, value]) => ({ name, value }));

    return {
      uniqueIps: uniqueIps.size,
      totalPorts,
      topPorts,
      topServices,
      protocols,
      ips: Array.from(uniqueIps).slice(0, 20) // Show first 20 IPs
    };
  }, [results]);

  return (
    <div className="space-y-6">
      {/* Top Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="资产" value={stats.uniqueIps} icon={<Layers size={80} />} color="blue" />
        <StatCard title="存活IP" value={stats.uniqueIps} icon={<Globe size={80} />} color="blue" />
        <StatCard title="端口" value={stats.totalPorts} icon={<Terminal size={80} />} color="blue" />
        <StatCard title="漏洞" value={0} icon={<ShieldAlert size={80} />} color="blue" />
      </div>

      {/* Main Grid of Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        
        {/* Protocol Distribution (reusing Hardware card slot) */}
        <ChartCard title="协议分布" icon={<Cpu size={16} />}>
          {stats.protocols.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={stats.protocols}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {stats.protocols.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={chartColors[index % chartColors.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                  itemStyle={{ color: '#e4e4e7' }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-zinc-500 text-sm">暂无数据</div>
          )}
        </ChartCard>

        {/* Service Distribution List */}
        <ChartCard title="服务类型" icon={<Monitor size={16} />}>
          <div className="w-full flex flex-col gap-3 px-2 overflow-y-auto max-h-full">
            {stats.topServices.map((item, idx) => (
              <div key={idx} className="space-y-1">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-zinc-400">{item.name}</span>
                  <span className="text-zinc-500">{item.value}</span>
                </div>
                <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-blue-500 rounded-full transition-all duration-1000"
                    style={{ width: `${(item.value / stats.totalPorts) * 100}%` }}
                  ></div>
                </div>
              </div>
            ))}
            {stats.topServices.length === 0 && <div className="text-zinc-500 text-sm text-center mt-10">暂无数据</div>}
          </div>
        </ChartCard>

        {/* Top Ports Bar Chart */}
        <ChartCard title="端口分布" icon={<Terminal size={16} />}>
           <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.topPorts}>
              <XAxis dataKey="name" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
              <Tooltip 
                cursor={{ fill: '#27272a' }}
                contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
              />
              <Bar dataKey="value" fill={COLORS.purple} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Software Vendors (Placeholder for now, maybe map services to vendors later) */}
        <ChartCard title="软件厂商" icon={<Server size={16} />}>
          <div className="flex flex-col items-center justify-center text-center gap-3">
             <div className="w-20 h-20 rounded-full border-4 border-zinc-800 flex items-center justify-center">
                <span className="text-xl font-bold">{stats.topServices.length}</span>
             </div>
             <p className="text-xs text-zinc-500 max-w-[150px]">共检测到 {stats.topServices.length} 种不同的服务</p>
          </div>
        </ChartCard>

        {/* Asset Types (Placeholder - reusing protocol or just static for now) */}
        <ChartCard title="资产类型" icon={<Layers size={16} />}>
           <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={[{name: 'Server', value: stats.uniqueIps}]}
                cx="50%"
                cy="50%"
                outerRadius={80}
                dataKey="value"
                labelLine={false}
              >
                 <Cell fill={COLORS.blue} />
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* IP List */}
        <ChartCard title="IP 列表" icon={<Network size={16} />}>
          <div className="w-full space-y-2 overflow-y-auto max-h-full pr-1">
            {stats.ips.map((ip, i) => (
              <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-zinc-900/50 hover:bg-zinc-800 text-xs transition-colors">
                <span className="text-zinc-300 font-mono">{ip}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">Active</span>
              </div>
            ))}
            {stats.ips.length === 0 && <div className="text-zinc-500 text-sm text-center mt-10">暂无数据</div>}
          </div>
        </ChartCard>

        {/* Top Ports Horizontal Bar */}
        <ChartCard title="端口排行" icon={<Terminal size={16} />}>
           <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.topPorts} layout="vertical">
              <XAxis type="number" hide />
              <YAxis dataKey="name" type="category" stroke="#52525b" fontSize={10} width={30} tickLine={false} axisLine={false} />
              <Tooltip />
              <Bar dataKey="value" fill={COLORS.green} radius={[0, 4, 4, 0]} barSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Vulnerabilities (Placeholder) */}
        <ChartCard title="漏洞" icon={<ShieldAlert size={16} />}>
          <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
            暂无漏洞数据
          </div>
        </ChartCard>
      </div>
    </div>
  );
};

export default DashboardGrid;
