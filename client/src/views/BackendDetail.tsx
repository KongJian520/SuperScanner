import React, { useEffect, useState } from 'react';
import { BackendConfig, ServerInfo } from '../types';
import * as api from '@/lib/api';
import { toast } from 'sonner';
import { getUsagePercentage } from '@/lib/utils';
import { Activity, Clock, Cpu, HardDrive,  RefreshCcw, Server, Terminal } from 'lucide-react';

interface BackendDetailProps {
    backend: BackendConfig;
}

export const BackendDetail: React.FC<BackendDetailProps> = ({ backend }) => {
    const [info, setInfo] = useState<ServerInfo | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        const res = await api.getServerInfo(backend.address ?? backend.name);
        if (!res.ok) {
            console.error('getServerInfo error', res.error);
            setError('Failed to retrieve server metrics.');
            toast.error('获取服务器指标失败：' + res.error);
            setLoading(false);
            return;
        }
        // Debug: log raw payload returned from backend for inspection
        // This helps confirm field shapes and types (numbers vs strings).
        // eslint-disable-next-line no-console
        console.log('getServerInfo raw:', res.data);

        // API returns normalized ServerInfo (normalizeServerInfoDto in api.ts)
        setInfo(res.data);
        setLoading(false);
    };

    useEffect(() => {
        fetchData();
        // In a real app, we might poll this
        const interval = setInterval(fetchData, 10000);
        return () => clearInterval(interval);
    }, [backend.name, backend.address]);

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    const formatUptime = (seconds: number) => {
        const days = Math.floor(seconds / (3600 * 24));
        const hours = Math.floor(seconds % (3600 * 24) / 3600);
        const minutes = Math.floor(seconds % 3600 / 60);
        return `${days}d ${hours}h ${minutes}m`;
    };



    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
            {/* Header Section */}
            <div className="p-6 border-b border-border bg-card/50 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-500 border border-blue-500/20">
                        <Server size={24} />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-white tracking-tight">{backend.name}</h1>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                            <span className="bg-secondary px-1.5 py-0.5 rounded text-gray-300 font-mono">{backend.address ?? backend.name}</span>
                            <span>•</span>
                        </div>
                    </div>
                </div>
                <button
                    onClick={fetchData}
                    disabled={loading}
                    className="p-2 hover:bg-white/5 rounded-md text-gray-400 hover:text-white transition-colors"
                    title="Refresh Metrics"
                >
                    <RefreshCcw size={18} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* Dashboard Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">

                {info && (
                    <>
                        {/* Top Stats Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {/* OS / System */}
                            <div className="bg-card border border-border rounded-lg p-4 flex flex-col justify-between hover:border-blue-500/30 transition-colors">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="text-xs font-semibold text-muted-foreground uppercase">System</span>
                                    <Terminal size={16} className="text-gray-500" />
                                </div>
                                <div>
                                    <div className="text-sm font-medium text-white truncate" title={info.os ?? 'unknown'}>{info.os ?? 'unknown'}</div>
                                    <div className="text-xs text-gray-500 font-mono mt-1">{info.hostname ?? 'unknown'}</div>
                                </div>
                            </div>

                            {/* Uptime */}
                            <div className="bg-card border border-border rounded-lg p-4 flex flex-col justify-between hover:border-green-500/30 transition-colors">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="text-xs font-semibold text-muted-foreground uppercase">Uptime</span>
                                    <Clock size={16} className="text-gray-500" />
                                </div>
                                <div>
                                    <div className="text-lg font-mono text-green-400">{formatUptime(info.uptimeSeconds ?? 0)}</div>
                                    <div className="text-xs text-gray-500 mt-1">Version {info.version ?? 'unknown'}</div>
                                </div>
                            </div>

                            {/* Load Average */}
                            <div className="bg-card border border-border rounded-lg p-4 flex flex-col justify-between hover:border-orange-500/30 transition-colors">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="text-xs font-semibold text-muted-foreground uppercase">Load Average</span>
                                    <Activity size={16} className="text-gray-500" />
                                </div>
                                <div>
                                    <div className="flex gap-2 font-mono text-sm text-white">
                                        {(info.loadAverage ?? []).map((load, idx) => (
                                            <span key={idx} className="bg-black/40 px-2 py-1 rounded border border-white/5">
                                                {load.toFixed(2)}
                                            </span>
                                        ))}
                                    </div>
                                    <div className="text-xs text-gray-500 mt-2">{info.cpuCores ?? 0} Cores Available</div>
                                </div>
                            </div>
                        </div>

                        {/* Resource Bars */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Memory */}
                            <div className="bg-card border border-border rounded-lg p-5">
                                <div className="flex items-center gap-2 mb-4">
                                    <Cpu size={18} className="text-purple-400" />
                                    <h3 className="text-sm font-semibold text-white">Memory Usage</h3>
                                </div>

                                <div className="space-y-1">
                                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                                        <span>Used: {formatBytes((info.memoryTotalBytes ?? 0) - (info.memoryFreeBytes ?? 0))}</span>
                                        <span>Total: {formatBytes(info.memoryTotalBytes ?? 0)}</span>
                                    </div>
                                    <div className="h-2.5 bg-secondary rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-purple-500 transition-all duration-1000 ease-out"
                                            style={{ width: `${getUsagePercentage(info.memoryTotalBytes ?? 0, info.memoryFreeBytes ?? 0)}%` }}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Disk */}
                            <div className="bg-card border border-border rounded-lg p-5">
                                <div className="flex items-center gap-2 mb-4">
                                    <HardDrive size={18} className="text-yellow-400" />
                                    <h3 className="text-sm font-semibold text-white">Storage Usage</h3>
                                </div>

                                <div className="space-y-1">
                                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                                        <span>Used: {formatBytes((info.diskTotalBytes ?? 0) - (info.diskFreeBytes ?? 0))}</span>
                                        <span>Total: {formatBytes(info.diskTotalBytes ?? 0)}</span>
                                    </div>
                                    <div className="h-2.5 bg-secondary rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-yellow-500 transition-all duration-1000 ease-out"
                                            style={{ width: `${getUsagePercentage(info.diskTotalBytes ?? 0, info.diskFreeBytes ?? 0)}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>


                    </>
                )}

                {!info && !loading && !error && (
                    <div className="p-8 text-center text-muted-foreground border border-dashed border-border rounded-lg">
                        No server metrics available for this backend type.
                    </div>
                )}


            </div>
        </div>
    );
};
