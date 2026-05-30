import React from 'react';
import { Finding, ScanResult } from '../types';
import DashboardGrid from './DashboardGrid';

interface TaskResultsOverviewProps {
  results: ScanResult[];
  findings?: Finding[];
}

const TaskResultsOverview: React.FC<TaskResultsOverviewProps> = ({ results, findings = [] }) => {
  return <DashboardGrid results={results} findings={findings} />;
};

export default TaskResultsOverview;
