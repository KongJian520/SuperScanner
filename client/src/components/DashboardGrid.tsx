import React, { useMemo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, useInView, useReducedMotion } from 'framer-motion';
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
function useCountUp(target: number, duration = 600, shouldStart = true, disabled = false) {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);
  useEffect(() => {
    if (disabled) {
      setValue(target);
      return;
    }
    if (!shouldStart) {
      setValue(0);
      return;
    }

    const startTime = performance.now();
    const from = 0;
    const animate = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setValue(Math.round(from + (target - from) * ease));
      if (progress < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration, shouldStart, disabled]);
  return value;
}

const cardColors: Record<string, { bg: string; border: string; text: string }> = {
  blue:   { bg: 'bg-blue-600',   border: 'border-blue-500/30',   text: 'text-blue-200' },
  purple: { bg: 'bg-purple-700', border: 'border-purple-500/30', text: 'text-purple-200' },
  green:  { bg: 'bg-emerald-700',border: 'border-emerald-500/30',text: 'text-emerald-200' },
  red:    { bg: 'bg-rose-700',   border: 'border-rose-500/30',   text: 'text-rose-200' },
};

const StatCard: React.FC<{ title: string; value: number; icon: React.ReactNode; color: string }> = ({ title, value, icon, color }) => {
  const shouldReduceMotion = !!useReducedMotion();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const isInView = useInView(cardRef, { once: true, amount: 0.35 });
  const displayValue = useCountUp(value, shouldReduceMotion ? 0 : 600, isInView, shouldReduceMotion);
  const c = cardColors[color] ?? cardColors.blue;
  return (
    <motion.div
      ref={cardRef}
      className={`relative overflow-hidden ${c.bg} rounded-xl p-5 group cursor-default border ${c.border}`}
      initial={shouldReduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.35 }}
      whileHover={shouldReduceMotion ? undefined : { y: -2, scale: 1.01 }}
      transition={{ duration: shouldReduceMotion ? 0 : 0.22, ease: 'easeOut' }}
    >
      <div className="absolute right-[-10px] bottom-[-10px] opacity-20 transform scale-150 rotate-[-15deg] group-hover:scale-[1.8] transition-transform duration-300">
        {icon}
      </div>
      <div className="relative z-10 flex flex-col gap-1">
        <p className="text-white/80 text-sm font-medium tracking-wide uppercase">{title}</p>
        <p className="text-4xl font-black text-white tabular-nums">{displayValue}</p>
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
}> = ({ title, icon, children, verified = true, delay = 0 }) => {
  const shouldReduceMotion = !!useReducedMotion();
  return (
    <motion.div
      className="bg-card rounded-xl border border-border flex flex-col h-[320px]"
      initial={shouldReduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: shouldReduceMotion ? 0 : 0.2, ease: 'easeOut', delay: shouldReduceMotion ? 0 : Math.min(delay, 0.18) }}
    >
      <div className="p-4 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-blue-500">{icon}</span>
          <span className="font-semibold text-sm text-foreground">{title}</span>
          {verified && <CheckCircle2 size={14} className="text-green-500/80" />}
        </div>
        <ChevronRight size={16} className="text-muted-foreground cursor-pointer hover:text-foreground transition-colors" />
      </div>
      <div className="flex-1 p-4 flex items-center justify-center overflow-hidden">
        {children}
      </div>
    </motion.div>
  );
};

interface DashboardGridProps {
  results: ScanResult[];
}

const DashboardGrid: React.FC<DashboardGridProps> = ({ results = [] }) => {
  const { t } = useTranslation();
  const shouldReduceMotion = !!useReducedMotion();
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
        <StatCard title={t('dashboard.assets')} value={stats.uniqueIps} icon={<Layers size={80} />} color="blue" />
        <StatCard title={t('dashboard.alive_ips')} value={stats.uniqueIps} icon={<Globe size={80} />} color="green" />
        <StatCard title={t('dashboard.ports')} value={stats.totalPorts} icon={<Terminal size={80} />} color="purple" />
        <StatCard title={t('dashboard.vulns')} value={0} icon={<ShieldAlert size={80} />} color="red" />
      </div>

      {/* Main Grid of Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        
        {/* Protocol Distribution (reusing Hardware card slot) */}
        <ChartCard title={t('dashboard.protocol_dist')} icon={<Cpu size={16} />} delay={0.05}>
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
                  isAnimationActive={!shouldReduceMotion}
                >
                  {stats.protocols.map((_entry, index) => (
                    <Cell key={`cell-${index}`} fill={chartColors[index % chartColors.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px' }}
                  itemStyle={{ color: 'var(--foreground)' }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-muted-foreground text-sm">{t('dashboard.no_data')}</div>
          )}
        </ChartCard>

        {/* Service Distribution List */}
        <ChartCard title={t('dashboard.service_types')} icon={<Monitor size={16} />} delay={0.1}>
          <div className="w-full flex flex-col gap-3 px-2 overflow-y-auto max-h-full">
            {stats.topServices.map((item, idx) => (
              <div key={idx} className="space-y-1">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-muted-foreground">{item.name}</span>
                  <span className="text-muted-foreground">{item.value}</span>
                </div>
                <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full motion-safe:transition-[width] motion-safe:duration-500"
                    style={{ width: `${(item.value / stats.totalPorts) * 100}%` }}
                  ></div>
                </div>
              </div>
            ))}
            {stats.topServices.length === 0 && <div className="text-muted-foreground text-sm text-center mt-10">{t('dashboard.no_data')}</div>}
          </div>
        </ChartCard>

        {/* Top Ports Bar Chart */}
        <ChartCard title={t('dashboard.port_dist')} icon={<Terminal size={16} />} delay={0.15}>
           <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.topPorts}>
              <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ fill: 'var(--accent)' }}
                contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px' }}
              />
              <Bar dataKey="value" fill={COLORS.purple} radius={[4, 4, 0, 0]} isAnimationActive={!shouldReduceMotion} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Software Vendors (Placeholder for now, maybe map services to vendors later) */}
        <ChartCard title={t('dashboard.software_vendors')} icon={<Server size={16} />} delay={0.2}>
          <div className="flex flex-col items-center justify-center text-center gap-3">
             <div className="w-20 h-20 rounded-full border-4 border-border flex items-center justify-center">
                <span className="text-xl font-bold text-foreground">{stats.topServices.length}</span>
             </div>
             <p className="text-xs text-muted-foreground max-w-[150px]">{t('dashboard.services_detected', { count: stats.topServices.length })}</p>
          </div>
        </ChartCard>

        {/* Asset Types (Placeholder - reusing protocol or just static for now) */}
        <ChartCard title={t('dashboard.asset_types')} icon={<Layers size={16} />} delay={0.25}>
           <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={[{name: 'Server', value: stats.uniqueIps}]}
                cx="50%"
                cy="50%"
                outerRadius={80}
                dataKey="value"
                labelLine={false}
                isAnimationActive={!shouldReduceMotion}
              >
                 <Cell fill={COLORS.blue} />
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* IP List */}
        <ChartCard title={t('dashboard.ip_list')} icon={<Network size={16} />} delay={0.3}>
          <div className="w-full space-y-2 overflow-y-auto max-h-full pr-1">
            {stats.ips.map((ip, i) => (
              <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-muted hover:bg-accent text-xs transition-colors">
                <span className="text-foreground font-mono">{ip}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">{t('dashboard.active')}</span>
              </div>
            ))}
            {stats.ips.length === 0 && <div className="text-muted-foreground text-sm text-center mt-10">{t('dashboard.no_data')}</div>}
          </div>
        </ChartCard>

        {/* Top Ports Horizontal Bar */}
        <ChartCard title={t('dashboard.port_rank')} icon={<Terminal size={16} />} delay={0.35}>
           <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.topPorts} layout="vertical">
              <XAxis type="number" hide />
              <YAxis dataKey="name" type="category" stroke="var(--muted-foreground)" fontSize={10} width={30} tickLine={false} axisLine={false} />
              <Tooltip />
              <Bar dataKey="value" fill={COLORS.green} radius={[0, 4, 4, 0]} barSize={20} isAnimationActive={!shouldReduceMotion} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Vulnerabilities (Placeholder) */}
        <ChartCard title={t('dashboard.vulns')} icon={<ShieldAlert size={16} />} delay={0.4}>
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            {t('dashboard.no_vuln_data')}
          </div>
        </ChartCard>
      </div>
    </div>
  );
};

export default DashboardGrid;
