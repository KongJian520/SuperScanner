import React from 'react';
import { ScanResult } from '../types';
import DashboardGrid from './DashboardGrid';

interface TaskResultsOverviewProps {
  results: ScanResult[];
}

const TaskResultsOverview: React.FC<TaskResultsOverviewProps> = ({ results }) => {
  return <DashboardGrid results={results} />;
};

export default TaskResultsOverview;
