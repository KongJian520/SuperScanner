import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Server, Wifi, WifiOff } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useBackendHealth, useBackends, useDeleteBackend } from '../hooks/use-scanner-api';
import { useAppStore } from '../lib/store';
import { microInteraction, routeLite, sectionEnter, stateTransition } from '../lib/motion';

const serverCardVariants = {
  hidden: (index: number) => ({
    opacity: 0,
    y: 16,
    x: index % 2 === 0 ? -10 : 10,
    scale: 0.99,
    filter: 'blur(6px)',
  }),
  show: (index: number) => ({
    opacity: 1,
    y: 0,
    x: 0,
    scale: 1,
    filter: 'blur(0px)',
    transition: {
      duration: 0.34,
      delay: Math.min(index * 0.04, 0.2),
    },
  }),
};

export const ServersOverview: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setActiveBackendId, setActiveTaskId, setDefaultBackendId } = useAppStore();
  const { data: backends = [], isLoading, error } = useBackends();
  const { data: backendHealth = {} } = useBackendHealth(backends);
  const { mutate: deleteBackend } = useDeleteBackend();

  const handleSelectBackend = (id: string) => {
    setActiveBackendId(id);
    setDefaultBackendId(id);
    setActiveTaskId(null);
    navigate(`/server/${id}`);
  };

  const handleDeleteBackend = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteBackend(id);
  };

  return (
    <motion.div
      className="p-3 sm:p-6 overflow-y-auto h-full"
      variants={routeLite.mainNavSwitch}
      initial="initial"
      animate="animate"
    >
      <div className="flex flex-col items-start sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-6">
        <motion.div
          className="flex items-center gap-3"
          initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        >
          <Server size={20} className="text-muted-foreground" />
          <h2 className="text-xl font-bold text-foreground">{t('servers.title')}</h2>
        </motion.div>
        <motion.button
          onClick={() => navigate('/servers/new')}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 24, delay: 0.06 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="px-3 py-1.5 w-full sm:w-auto bg-primary text-primary-foreground text-sm font-semibold rounded-md hover:opacity-90 transition-opacity"
        >
          {t('servers.add')}
        </motion.button>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {isLoading ? (
          <motion.div
            key="loading"
            className="grid grid-cols-1 sm:grid-cols-2 gap-3"
            variants={stateTransition.surface}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            {[...Array(3)].map((_, i) => (
              <motion.div
                key={i}
                className="h-20 rounded-lg bg-card"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: [0.35, 0.6, 0.35], y: 0 }}
                transition={{ duration: 1.4, delay: i * 0.1, repeat: Infinity, ease: 'easeInOut' }}
              />
            ))}
          </motion.div>
        ) : error ? (
          <motion.div
            key="error"
            className="p-8 text-center text-red-400 border border-dashed border-red-900/50 rounded-lg text-sm"
            variants={stateTransition.surface}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            {error.message}
          </motion.div>
        ) : backends.length === 0 ? (
          <motion.div
            key="empty"
            className="p-8 text-center text-muted-foreground border border-dashed border-border rounded-lg text-sm"
            variants={stateTransition.surface}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            {t('servers.no_backends')}
          </motion.div>
        ) : (
          <motion.div
            key="content"
            className="grid grid-cols-1 sm:grid-cols-2 gap-3"
            variants={stateTransition.surface}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <motion.div
              className="contents"
              variants={sectionEnter.listStagger}
              initial="hidden"
              animate="show"
            >
              {backends.map((b, idx) => (
                <motion.div
                  custom={idx}
                  variants={serverCardVariants}
                  whileHover={{
                    ...microInteraction.cardHoverLift,
                    transition: { type: 'spring', stiffness: 300, damping: 24 },
                  }}
                  whileTap={{ scale: 0.995 }}
                  key={b.id ?? `${b.name}-${idx}`}
                  className="group relative flex items-center gap-3 sm:gap-4 p-3 sm:p-4 bg-card border border-border rounded-lg cursor-pointer hover:bg-accent hover:border-primary/30 transition-all"
                  onClick={() => handleSelectBackend(b.id)}
                >
                  <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-500 border border-blue-500/20 flex-shrink-0">
                    <Server size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-foreground truncate">{b.name}</div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                      <AnimatePresence mode="wait" initial={false}>
                        {backendHealth[b.id]?.state === 'online' ? (
                          <motion.span
                            key={`${b.id ?? idx}-health-online`}
                            className="flex items-center gap-1.5 min-w-0"
                            initial={{ opacity: 0, y: -3, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 3, scale: 0.95 }}
                            transition={{ duration: 0.18 }}
                          >
                            <motion.span
                              animate={{ opacity: [0.65, 1, 0.65] }}
                              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                            >
                              <Wifi size={10} className="text-green-500" />
                            </motion.span>
                            <span className="font-mono truncate">
                              {t('servers.health_online')} · {backendHealth[b.id]?.latencyMs ?? '-'}ms
                            </span>
                          </motion.span>
                        ) : backendHealth[b.id]?.state === 'offline' ? (
                          <motion.span
                            key={`${b.id ?? idx}-health-offline`}
                            className="flex items-center gap-1.5 min-w-0"
                            initial={{ opacity: 0, y: -3, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 3, scale: 0.95 }}
                            transition={{ duration: 0.18 }}
                          >
                            <WifiOff size={10} className="text-destructive" />
                            <span>{t('servers.health_offline')}</span>
                          </motion.span>
                        ) : (
                          <motion.span
                            key={`${b.id ?? idx}-health-unknown`}
                            className="flex items-center gap-1.5 min-w-0"
                            initial={{ opacity: 0, y: -3, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 3, scale: 0.95 }}
                            transition={{ duration: 0.18 }}
                          >
                            <WifiOff size={10} />
                            <span>{t('servers.health_unknown')}</span>
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDeleteBackend(b.id ?? `${b.name}-${idx}`, e)}
                    className="text-xs text-destructive opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity hover:underline flex-shrink-0"
                  >
                    {t('servers.delete')}
                  </button>
                </motion.div>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default ServersOverview;
