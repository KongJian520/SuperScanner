import React from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { BackendDetail } from '@/views/BackendDetail';
import { useBackends } from '../hooks/use-scanner-api';

export const ServerDetailRoute: React.FC = () => {
  const { id } = useParams();
  const { data: backends } = useBackends();
  
  if (!id) return <Navigate to="/servers" replace />;
  const backend = backends?.find(b => b.id === id);
  
  if (!backend) return <div className="p-8 text-center text-muted-foreground">Loading server details...</div>;

  return <BackendDetail backend={backend} />;
};

export default ServerDetailRoute;
