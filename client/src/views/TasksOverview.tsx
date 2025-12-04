import React from 'react';
import { Task } from '@/types';
import { useNavigate } from 'react-router-dom';
import { List } from 'lucide-react';

interface Props {
  tasks: Task[];
  onSelectTask: (id: string) => void;
  onDeleteTask: (id: string, e: React.MouseEvent) => void;
}

export const TasksOverview: React.FC<Props> = ({ tasks, onSelectTask, onDeleteTask }) => {
  const navigate = useNavigate();

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <List />
          <h2 className="text-xl font-bold">Tasks</h2>
        </div>
        <div>
          <button onClick={() => navigate('/tasks/new')} className="px-3 py-2 bg-white text-black rounded-md">New Task</button>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="text-sm text-muted-foreground">No tasks yet. Create one to get started.</div>
      ) : (
        <div className="space-y-2">
          {tasks.map(t => (
            <div key={t.id} className="flex items-center justify-between p-3 bg-card rounded-md cursor-pointer" onClick={() => onSelectTask(t.id)}>
              <div>
                <div className="font-semibold">{t.name}</div>
                <div className="text-xs text-muted-foreground">{(t.targets?.length ?? 0)} targets</div>
              </div>
              <div>
                <button onClick={(e) => { e.stopPropagation(); onDeleteTask(t.id, e); }} className="text-sm text-red-400">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TasksOverview;
