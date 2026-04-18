import React from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { BackendDetail } from '@/views/BackendDetail';
import { useBackends } from '../hooks/use-scanner-api';
import { routeLite, stateTransition } from '../lib/motion';

export const ServerDetailRoute: React.FC = () => {
  const { t } = useTranslation();
  const { id } = useParams();
  const { data: backends, isLoading } = useBackends();
  
  if (!id) return <Navigate to="/servers" replace />;
  const backend = backends?.find(b => b.id === id);

  return (
    <div className="h-full">
      <AnimatePresence mode="wait" initial={false}>
        {isLoading ? (
          <motion.div
            key="loading"
            className="p-8 text-center text-muted-foreground"
            variants={stateTransition.surface}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            {t('backend_detail.loading_server_details')}
          </motion.div>
        ) : !backend ? (
          <motion.div
            key="not-found"
            className="p-8 text-center text-muted-foreground border border-dashed border-border rounded-lg"
            variants={stateTransition.surface}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            {t('backend_detail.server_not_found')}
          </motion.div>
        ) : (
          <motion.div
            key="content"
            className="h-full"
            variants={routeLite.taskSwitchContainer}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <BackendDetail backend={backend} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ServerDetailRoute;
