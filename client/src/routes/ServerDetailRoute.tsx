import React from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { BackendConfig } from '@/types';
import { BackendDetail } from '@/views/BackendDetail';

interface Props {
  backends: BackendConfig[];
}

export const ServerDetailRoute: React.FC<Props> = ({ backends }) => {
  const { id } = useParams();
  if (!id) return <Navigate to="/servers" replace />;
  const backend = backends.find(b => b.id === id);
  if (!backend) return <Navigate to="/servers" replace />;
  return <BackendDetail backend={backend} />;
};

export default ServerDetailRoute;
