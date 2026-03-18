import React from 'react';
import { useTranslation } from 'react-i18next';
import { BackendConfig } from '../types';
import { getUsagePercentage } from '@/lib/utils';
import { Activity, Clock, Cpu, HardDrive,  RefreshCcw, Server, Terminal } from 'lucide-react';
import { useServerInfo } from '../hooks/use-scanner-api';

interface BackendDetailProps {
    backend: BackendConfig;
}

export const BackendDetail: React.FC<BackendDetailProps> = ({ backend }) => {
    const { t } = useTranslation();
    const { data: info, isLoading: loading, error, refetch } = useServerInfo(backend.id);

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
                        <h1 className="text-xl font-bold text-foreground tracking-tight">{backend.name}</h1>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                            <span className="bg-secondary px-1.5 py-0.5 rounded text-muted-foreground font-mono">{backend.address ?? backend.name}</span>
                            <span>•</span>
                        </div>
                    </div>
                </div>
                <button
                    onClick={() => refetch()}
                    disabled={loading}
                    className="p-2 hover:bg-accent rounded-md text-muted-foreground hover:text-foreground transition-colors"
                    title={t('backend_detail.refresh_metrics')}
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
                                    <span className="text-xs font-semibold text-muted-foreground uppercase">{t('backend_detail.system')}</span>
                                    <Terminal size={16} className="text-muted-foreground" />
                                </div>
                                <div>
                                    <div className="text-sm font-medium text-foreground truncate" title={info.os ?? t('backend_detail.unknown')}>{info.os ?? t('backend_detail.unknown')}</div>
                                    <div className="text-xs text-muted-foreground font-mono mt-1">{info.hostname ?? t('backend_detail.unknown')}</div>
                                </div>
                            </div>

                            {/* Uptime */}
                            <div className="bg-card border border-border rounded-lg p-4 flex flex-col justify-between hover:border-green-500/30 transition-colors">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="text-xs font-semibold text-muted-foreground uppercase">{t('backend_detail.uptime')}</span>
                                    <Clock size={16} className="text-muted-foreground" />
                                </div>
                                <div>
                                    <div className="text-lg font-mono text-green-400">{formatUptime(info.uptimeSeconds ?? 0)}</div>
                                    <div className="text-xs text-muted-foreground mt-1">{t('backend_detail.version', { version: info.version ?? t('backend_detail.unknown') })}</div>
                                </div>
                            </div>

                            {/* Load Average */}
                            <div className="bg-card border border-border rounded-lg p-4 flex flex-col justify-between hover:border-orange-500/30 transition-colors">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="text-xs font-semibold text-muted-foreground uppercase">{t('backend_detail.load_average')}</span>
                                    <Activity size={16} className="text-muted-foreground" />
                                </div>
                                <div>
                                    <div className="flex gap-2 font-mono text-sm text-foreground">
                                        {(info.loadAverage ?? []).map((load, idx) => (
                                            <span key={idx} className="bg-muted px-2 py-1 rounded border border-border">
                                                {load.toFixed(2)}
                                            </span>
                                        ))}
                                    </div>
                                    <div className="text-xs text-muted-foreground mt-2">{t('backend_detail.cores_available', { count: info.cpuCores ?? 0 })}</div>
                                </div>
                            </div>
                        </div>

                        {/* Resource Bars */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Memory */}
                            <div className="bg-card border border-border rounded-lg p-5">
                                <div className="flex items-center gap-2 mb-4">
                                    <Cpu size={18} className="text-purple-400" />
                                    <h3 className="text-sm font-semibold text-foreground">{t('backend_detail.memory_usage')}</h3>
                                </div>

                                <div className="space-y-1">
                                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                                        <span>{t('backend_detail.used')}: {formatBytes((info.memoryTotalBytes ?? 0) - (info.memoryFreeBytes ?? 0))}</span>
                                        <span>{t('backend_detail.total')}: {formatBytes(info.memoryTotalBytes ?? 0)}</span>
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
                                    <h3 className="text-sm font-semibold text-foreground">{t('backend_detail.disk_usage')}</h3>
                                </div>

                                <div className="space-y-1">
                                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                                        <span>{t('backend_detail.used')}: {formatBytes((info.diskTotalBytes ?? 0) - (info.diskFreeBytes ?? 0))}</span>
                                        <span>{t('backend_detail.total')}: {formatBytes(info.diskTotalBytes ?? 0)}</span>
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

                {loading && (
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {[...Array(3)].map((_, i) => (
                                <div key={i} className="h-24 rounded-lg bg-card animate-pulse" style={{ animationDelay: `${i * 100}ms` }} />
                            ))}
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {[...Array(2)].map((_, i) => (
                                <div key={i} className="h-32 rounded-lg bg-card animate-pulse" style={{ animationDelay: `${(i + 3) * 100}ms` }} />
                            ))}
                        </div>
                    </div>
                )}

                {!info && !loading && !error && (
                    <div className="p-8 text-center text-muted-foreground border border-dashed border-border rounded-lg">
                        {t('backend_detail.no_metrics')}
                    </div>
                )}

                {error && (
                    <div className="p-8 text-center text-red-400 border border-dashed border-red-900/50 rounded-lg">
                        {t('backend_detail.error_metrics', { message: error.message })}
                    </div>
                )}


            </div>
        </div>
    );
};
