
import React from 'react';

export const COLORS = {
  blue: '#3b82f6',
  green: '#22c55e',
  red: '#ef4444',
  yellow: '#eab308',
  purple: '#a855f7',
  gray: '#71717a'
};

export const MOCK_TASKS = [
  {
    id: '1',
    name: 'Scan 127.0.0.1',
    status: 'DONE',
    targets: 2,
    progress: 100,
    startTime: '13:26:43',
    endTime: '14:36:58'
  },
  {
    id: '2',
    name: 'External Audit',
    status: 'RUNNING',
    targets: 12,
    progress: 45,
    startTime: '15:10:00',
    endTime: '-'
  },
  {
    id: '3',
    name: 'Internal Network',
    status: 'PENDING',
    targets: 250,
    progress: 0,
    startTime: '-',
    endTime: '-'
  }
];

export const MOCK_CHART_DATA = {
  hardware: [
    { name: 'Server', value: 45 },
    { name: 'Workstation', value: 30 },
    { name: 'Switch', value: 15 },
    { name: 'Other', value: 10 }
  ],
  vulnerabilities: [
    { name: 'Critical', value: 5 },
    { name: 'High', value: 12 },
    { name: 'Medium', value: 25 },
    { name: 'Low', value: 58 }
  ],
  ports: [
    { name: '80', value: 40 },
    { name: '443', value: 35 },
    { name: '22', value: 15 },
    { name: '3306', value: 10 }
  ]
};
