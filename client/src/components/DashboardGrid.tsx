import React, { useMemo, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
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

// count-up hook
function useCountUp(target: number, duration = 600) {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);
  useEffect(() => {
    const start = performance.now();
    const from = 0;
    const animate = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setValue(Math.round(from + (target - from) * ease));
      if (progress < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);
  return value;
}

const cardColors: Record<string, { bg: string; border: string; text: string }> = {
  blue:   { bg: 'bg-blue-600',   border: 'border-blue-500/30',   text: 'text-blue-200' },
  purple: { bg: 'bg-purple-700', border: 'border-purple-500/30', text: 'text-purple-200' },
  green:  { bg: 'bg-emerald-700',border: 'border-emerald-500/30',text: 'text-emerald-200' },
  red:    { bg: 'bg-rose-700',   border: 'border-rose-500/30',   text: 'text-rose-200' },
};

const StatCard: React.FC<{ title: string; value: number; icon: React.ReactNode; color: string }> = ({ title, value, icon, color }) => {
  const displayValue = useCountUp(value);
  const c = cardColors[color] ?? cardColors.blue;
  return (
    <motion.div
      className={`relative overflow-hidden ${c.bg} rounded-xl p-5 group cursor-default border ${c.border}`}
      whileHover={{ y: -4, scale: 1.02 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
    >
      <div className="absolute right-[-10px] bottom-[-10px] opacity-20 transform scale-150 rotate-[-15deg] group-hover:scale-[1.8] transition-transform duration-300">
        {icon}
      </div>
      <div className="relative z-10 flex flex-col gap-1">
        <p className="text-white/80 text-sm font-medium tracking-wide uppercase">{title}</p>
        <p className="text-4xl font-black text-white">{displayValue}</p>
      </div>
    </motion.div>
  );
};

const ChartCard: React.FC<{
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  verified?: boolean;
  delay?: number;
}> = ({ title, icon, children, verified = true, delay = 0 }) => (
  <motion.div
    className="bg-[#18181b] rounded-xl border border-zinc-800/50 flex flex-col h-[320px]"
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.25, ease: 'easeOut', delay }}
    whileHover={{ borderColor: 'rgba(99,102,241,0.35)' }}
  >
    <div className="p-4 flex items-center justify-between border-b border-zinc-800/50">
      <div className="flex items-center gap-2">
        <span className="text-blue-500">{icon}</span>
        <span className="font-semibold text-sm">{title}</span>
        {verified && <CheckCircle2 size={14} className="text-green-500/80" />}
      </div>
      <ChevronRight size={16} className="text-zinc-600 cursor-pointer hover:text-zinc-400 transition-colors" />
    </div>
    <div className="flex-1 p-4 flex items-center justify-center overflow-hidden">
      {children}
    </div>
  </motion.div>
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
        <StatCard title="存活IP" value={stats.uniqueIps} icon={<Globe size={80} />} color="green" />
        <StatCard title="端口" value={stats.totalPorts} icon={<Terminal size={80} />} color="purple" />
        <StatCard title="漏洞" value={0} icon={<ShieldAlert size={80} />} color="red" />
      </div>

      {/* Main Grid of Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        
        {/* Protocol Distribution (reusing Hardware card slot) */}
        <ChartCard title="协议分布" icon={<Cpu size={16} />} delay={0.05}>
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
                  {stats.protocols.map((_entry, index) => (
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
        <ChartCard title="服务类型" icon={<Monitor size={16} />} delay={0.1}>
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
        <ChartCard title="端口分布" icon={<Terminal size={16} />} delay={0.15}>
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
        <ChartCard title="软件厂商" icon={<Server size={16} />} delay={0.2}>
          <div className="flex flex-col items-center justify-center text-center gap-3">
             <div className="w-20 h-20 rounded-full border-4 border-zinc-800 flex items-center justify-center">
                <span className="text-xl font-bold">{stats.topServices.length}</span>
             </div>
             <p className="text-xs text-zinc-500 max-w-[150px]">共检测到 {stats.topServices.length} 种不同的服务</p>
          </div>
        </ChartCard>

        {/* Asset Types (Placeholder - reusing protocol or just static for now) */}
        <ChartCard title="资产类型" icon={<Layers size={16} />} delay={0.25}>
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
        <ChartCard title="IP 列表" icon={<Network size={16} />} delay={0.3}>
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
        <ChartCard title="端口排行" icon={<Terminal size={16} />} delay={0.35}>
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
        <ChartCard title="漏洞" icon={<ShieldAlert size={16} />} delay={0.4}>
          <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
            暂无漏洞数据
          </div>
        </ChartCard>
      </div>
    </div>
  );
};

export default DashboardGrid;
