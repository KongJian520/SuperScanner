import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackendConfig } from '../types';
import { getUsagePercentage } from '@/lib/utils';
import { Activity, ArrowLeft, Check, Clock, Cpu, HardDrive, RefreshCcw, Server, Terminal, X } from 'lucide-react';
import { useServerInfo } from '../hooks/use-scanner-api';
import { AnimatePresence, motion } from 'framer-motion';
import { microInteraction, stateTransition } from '../lib/motion';
import { Link } from 'react-router-dom';

interface BackendDetailProps {
    backend: BackendConfig;
}

export const BackendDetail: React.FC<BackendDetailProps> = ({ backend }) => {
    const { t } = useTranslation();
    const { data: info, isLoading: loading, error, refetch } = useServerInfo(backend.id);
    const [refreshState, setRefreshState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const resetTimer = useRef<number | null>(null);

    useEffect(() => {
        return () => {
            if (resetTimer.current) window.clearTimeout(resetTimer.current);
        };
    }, []);

    const setRefreshFeedback = (state: 'idle' | 'loading' | 'success' | 'error') => {
        if (resetTimer.current) window.clearTimeout(resetTimer.current);
        setRefreshState(state);
        if (state === 'success' || state === 'error') {
            resetTimer.current = window.setTimeout(() => setRefreshState('idle'), 1300);
        }
    };

    const handleRefresh = async () => {
        setRefreshFeedback('loading');
        const result = await refetch();
        setRefreshFeedback(result.error ? 'error' : 'success');
    };

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
            <div className="p-4 md:p-6 border-b border-border bg-card/50 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 md:gap-4 min-w-0">
                    <Link
                        to="/servers"
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/70 px-2.5 py-1.5 text-xs text-foreground hover:bg-accent/70 transition-colors md:text-sm"
                    >
                        <ArrowLeft size={14} />
                        {t('common.back')}
                    </Link>
                    <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-500 border border-blue-500/20">
                        <Server size={24} />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-xl font-bold text-foreground tracking-tight">{backend.name}</h1>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                            <span className="bg-secondary px-1.5 py-0.5 rounded text-muted-foreground font-mono truncate max-w-[26ch]">{backend.address ?? backend.name}</span>
                            <span>•</span>
                        </div>
                    </div>
                </div>
                <motion.button
                    onClick={handleRefresh}
                    disabled={loading || refreshState === 'loading'}
                    whileTap={{ scale: microInteraction.actionButtonPress.scale }}
                    transition={{ duration: microInteraction.actionButtonPress.duration, ease: microInteraction.actionButtonPress.ease }}
                    className={`p-2 rounded-md border transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                        refreshState === 'success'
                            ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
                            : refreshState === 'error'
                                ? 'text-destructive border-destructive/40 bg-destructive/10'
                                : 'text-muted-foreground border-transparent hover:bg-accent hover:text-foreground'
                    }`}
                    title={t('backend_detail.refresh_metrics')}
                >
                    {refreshState === 'success' ? (
                        <Check size={18} />
                    ) : refreshState === 'error' ? (
                        <X size={18} />
                    ) : (
                        <RefreshCcw size={18} className={refreshState === 'loading' ? 'animate-spin' : ''} />
                    )}
                </motion.button>
            </div>

            {/* Dashboard Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <AnimatePresence mode="wait" initial={false}>
                    {info ? (
                        <motion.div
                            key="content"
                            className="space-y-6"
                            variants={stateTransition.surface}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                        >
                        {/* Top Stats Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {/* OS / System */}
                            <div className="bg-card border border-border rounded-lg p-4 flex flex-col justify-between hover:border-blue-500/30 transition-colors">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="text-xs font-semibold text-muted-foreground uppercase">{t('backend_detail.system')}</span>
                                    <Terminal size={16} className="text-muted-foreground" />
                                </div>
                                <div>
                                    <div className="text-sm font-medium text-foreground truncate" title={info.os ?? t('common.na')}>{info.os ?? t('common.na')}</div>
                                    <div className="text-xs text-muted-foreground font-mono mt-1">{info.hostname ?? t('common.na')}</div>
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
                                    <div className="text-xs text-muted-foreground mt-1">{t('backend_detail.version', { version: info.version ?? t('common.na') })}</div>
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


                        </motion.div>
                    ) : loading ? (
                        <motion.div
                            key="loading"
                            className="space-y-4"
                            variants={stateTransition.surface}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                        >
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
                        </motion.div>
                    ) : error ? (
                        <motion.div
                            key="error"
                            className="p-8 text-center text-red-400 border border-dashed border-red-900/50 rounded-lg"
                            variants={stateTransition.surface}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                        >
                            {t('backend_detail.error_metrics', { message: error.message })}
                        </motion.div>
                    ) : (
                        <motion.div
                            key="empty"
                            className="p-8 text-center text-muted-foreground border border-dashed border-border rounded-lg"
                            variants={stateTransition.surface}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                        >
                        {t('backend_detail.no_metrics')}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
};
